using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls(Environment.GetEnvironmentVariable("ASPNETCORE_URLS") ?? "http://localhost:5000");
builder.Services.AddSignalR().AddJsonProtocol(o => o.PayloadSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.AddSingleton<MonitorStore>();
var app = builder.Build();
app.UseCors();
app.MapGet("/health", () => Results.Ok(new { service = "backend", status = "ok", timestamp = DateTimeOffset.UtcNow }));
app.MapGet("/api/monitoring/status", (MonitorStore store) => Results.Ok(store.Status));
app.MapPost("/api/monitoring/status", async (object payload, MonitorStore store, IHubContext<MonitoringHub> hub) => {
    store.Status = payload;
    await hub.Clients.All.SendAsync("StatusUpdated", payload);
    return Results.Accepted();
});
app.MapGet("/api/cycles", (MonitorStore store, int? page, int? pageSize) => {
    var size = Math.Clamp(pageSize ?? 50, 1, 200);
    var current = Math.Max(page ?? 1, 1);
    var rows = store.Cycles.OrderByDescending(c => c.CompletedAt).Skip((current - 1) * size).Take(size).ToArray();
    return Results.Ok(new { items = rows, total = store.Cycles.Count, page = current, pageSize = size });
});
app.MapPost("/api/cycles", async (CycleDto cycle, MonitorStore store, IHubContext<MonitoringHub> hub) => {
    if (string.IsNullOrWhiteSpace(cycle.CycleId) || cycle.DurationSeconds < 0 || cycle.CompletedAt == default || cycle.StartedAt == default)
        return Results.BadRequest(new { error = "A cycle ID, valid timestamps and non-negative duration are required." });
    var normalized = cycle with { StartedAt = cycle.StartedAt.ToUniversalTime(), CompletedAt = cycle.CompletedAt.ToUniversalTime() };
    if (store.Cycles.All(c => c.CycleId != normalized.CycleId)) {
        store.Cycles.Add(normalized);
        await hub.Clients.All.SendAsync("CycleCompleted", normalized);
    }
    return Results.Accepted();
});
app.MapGet("/api/reports/summary", (MonitorStore store, DateTimeOffset? from, DateTimeOffset? to) => {
    var start = (from ?? DateTimeOffset.UtcNow.Date).ToUniversalTime();
    var end = (to ?? DateTimeOffset.UtcNow).ToUniversalTime();
    var rows = store.Cycles.Where(c => c.CompletedAt >= start && c.CompletedAt <= end).ToArray();
    var durations = rows.Select(c => c.DurationSeconds).ToArray();
    var hourly = rows.GroupBy(c => c.CompletedAt.UtcDateTime.ToString("yyyy-MM-dd HH:00"))
        .OrderBy(g => g.Key).Select(g => new { hour = g.Key, count = g.Count() }).ToArray();
    return Results.Ok(new { completedCycles = rows.Length, averageDurationSeconds = durations.Length > 0 ? durations.Average() : (double?)null,
        minimumDurationSeconds = durations.Length > 0 ? durations.Min() : (double?)null, maximumDurationSeconds = durations.Length > 0 ? durations.Max() : (double?)null,
        recordedProductionSeconds = durations.Sum(), hourly, cycles = rows });
});
app.MapHub<MonitoringHub>("/hubs/monitoring");
app.Run();

public sealed class MonitoringHub : Hub { }
public sealed record CycleDto(string CycleId, DateTimeOffset StartedAt, DateTimeOffset CompletedAt, double DurationSeconds, string Status = "completed");
public sealed class MonitorStore {
    public object Status { get; set; } = new { state = "unavailable", detections = Array.Empty<object>(), updatedAt = (DateTimeOffset?)null };
    public ConcurrentBag<CycleDto> Cycles { get; } = new();
}
