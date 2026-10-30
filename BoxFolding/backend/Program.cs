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
app.MapGet("/api/cycles/{cycleId}", (string cycleId, MonitorStore store) =>
    store.Cycles.FirstOrDefault(c => c.CycleId == cycleId) is { } cycle ? Results.Ok(cycle) : Results.NotFound());
app.MapPost("/api/cycles", async (CycleDto cycle, MonitorStore store, IHubContext<MonitoringHub> hub) => {
    var expectedStages = new[] { "stage0", "stage1", "stage2" };
    var stageTimelineValid = cycle.StageTimeline is { Count: 3 } &&
        cycle.StageTimeline.Select(x => x.Stage).SequenceEqual(expectedStages) &&
        cycle.StageTimeline.Zip(cycle.StageTimeline.Skip(1), (previous, next) => previous.EnteredAt <= next.EnteredAt).All(x => x);
    var stageDurationsValid = cycle.StageDurationsSeconds is not null &&
        expectedStages.All(cycle.StageDurationsSeconds.ContainsKey) &&
        cycle.StageDurationsSeconds.Values.All(value => value >= 0);
    if (string.IsNullOrWhiteSpace(cycle.CycleId) || cycle.DurationSeconds < 0 || cycle.CompletedAt == default || cycle.StartedAt == default ||
        cycle.CompletedAt < cycle.StartedAt || !stageTimelineValid || !stageDurationsValid ||
        Math.Abs((cycle.CompletedAt - cycle.StartedAt).TotalSeconds - cycle.DurationSeconds) > 0.5 ||
        cycle.StageTimeline.Any(x => x.EnteredAt < cycle.StartedAt || x.EnteredAt > cycle.CompletedAt))
        return Results.BadRequest(new { error = "A valid completed stage0 → stage1 → stage2 cycle with ordered timestamps and non-negative stage durations is required." });
    var normalized = cycle with {
        StartedAt = cycle.StartedAt.ToUniversalTime(),
        CompletedAt = cycle.CompletedAt.ToUniversalTime(),
        StageTimeline = cycle.StageTimeline.Select(x => x with { EnteredAt = x.EnteredAt.ToUniversalTime() }).ToList()
    };
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
    var cyclesByVideo = rows.GroupBy(c => string.IsNullOrWhiteSpace(c.SourceVideo) ? "(unknown video)" : c.SourceVideo);
    var averageStageDurations = rows.Length > 0 ? new {
        stage0 = cyclesByVideo.Average(video => video.Average(c => c.StageDurationsSeconds["stage0"])),
        stage1 = cyclesByVideo.Average(video => video.Average(c => c.StageDurationsSeconds["stage1"])),
        stage2 = cyclesByVideo.Average(video => video.Average(c => c.StageDurationsSeconds["stage2"]))
    } : null;
    var hourly = rows.GroupBy(c => c.CompletedAt.UtcDateTime.ToString("yyyy-MM-dd HH:00"))
        .OrderBy(g => g.Key).Select(g => new { hour = g.Key, count = g.Count() }).ToArray();
    return Results.Ok(new { completedCycles = rows.Length, averageDurationSeconds = durations.Length > 0 ? durations.Average() : (double?)null, averageStageDurationsSeconds = averageStageDurations,
        minimumDurationSeconds = durations.Length > 0 ? durations.Min() : (double?)null, maximumDurationSeconds = durations.Length > 0 ? durations.Max() : (double?)null,
        recordedProductionSeconds = durations.Sum(), hourly, cycles = rows });
});
app.MapHub<MonitoringHub>("/hubs/monitoring");
app.Run();

public sealed class MonitoringHub : Hub { }
public sealed record StageTransitionDto(string Stage, DateTimeOffset EnteredAt, double Confidence);
public sealed record CycleDto(
    string CycleId,
    DateTimeOffset StartedAt,
    DateTimeOffset CompletedAt,
    double DurationSeconds,
    string CurrentStage,
    List<StageTransitionDto> StageTimeline,
    Dictionary<string, double> StageDurationsSeconds,
    string Status = "completed",
    string? SourceVideo = null);
public sealed class MonitorStore {
    public object Status { get; set; } = new { state = "unavailable", detections = Array.Empty<object>(), updatedAt = (DateTimeOffset?)null };
    public ConcurrentBag<CycleDto> Cycles { get; } = new();
}
