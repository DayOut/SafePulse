using HeartPulse.Events;
using HeartPulse.Models;
using HeartPulse.Options;
using HeartPulse.Services.Interfaces;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;

namespace HeartPulse.Services;

public class FakeStatusSimulatorHostedService(
    IMongoDatabase database,
    IServiceScopeFactory scopeFactory,
    IOptions<FakeStatusSimulatorOptions> options,
    ILogger<FakeStatusSimulatorHostedService> logger) : BackgroundService
{
    private readonly FakeStatusSimulatorOptions _options = options.Value;
    private readonly IMongoCollection<AppUser> _users = database.GetCollection<AppUser>("users");
    private readonly IMongoCollection<Group> _groups = database.GetCollection<Group>("groups");
    private readonly IMongoCollection<GroupUser> _groupUsers = database.GetCollection<GroupUser>("groupUsers");
    private readonly Random _random = new();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
            return;

        var group = await EnsureGroupAndUsersAsync(stoppingToken);
        var interval = TimeSpan.FromSeconds(Math.Max(1, _options.IntervalSeconds));

        using var timer = new PeriodicTimer(interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await UpdateFakeStatusesAsync(group.Id, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to update fake user statuses");
            }
        }
    }

    private async Task<Group> EnsureGroupAndUsersAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var groupFilter = Builders<Group>.Filter.And(
            Builders<Group>.Filter.Regex(g => g.Name, new BsonRegularExpression($"^{System.Text.RegularExpressions.Regex.Escape(_options.GroupName)}$", "i")),
            Builders<Group>.Filter.Ne(g => g.IsDeleted, true));

        var group = await _groups.Find(groupFilter)
            .FirstOrDefaultAsync(ct);

        if (group is null)
        {
            group = new Group
            {
                Id = Guid.NewGuid().ToString(),
                Name = _options.GroupName,
                OwnerId = _options.OwnerUserId,
                CreatedAt = now,
                UpdatedAt = now,
                IsDeleted = false
            };

            await _groups.InsertOneAsync(group, cancellationToken: ct);
        }

        for (var index = 1; index <= _options.UserCount; index++)
        {
            var userId = $"fake-fear-group-{index:000}";
            var userName = $"Fake User {index:000}";
            var status = PickStatus();

            await _users.UpdateOneAsync(
                u => u.Id == userId,
                Builders<AppUser>.Update
                    .SetOnInsert(u => u.Id, userId)
                    .Set(u => u.UserName, userName)
                    .SetOnInsert(u => u.Status, status)
                    .Set(u => u.IsFake, true)
                    .Set(u => u.IsDeleted, false)
                    .Set(u => u.LastActiveAt, now)
                    .Set(u => u.LastSeenOnlineAt, now)
                    .Set(u => u.UpdatedAt, now)
                    .SetOnInsert(u => u.CreatedAt, now),
                new UpdateOptions { IsUpsert = true },
                ct);

            await _groupUsers.UpdateOneAsync(
                gu => gu.GroupId == group.Id && gu.UserId == userId,
                Builders<GroupUser>.Update
                    .SetOnInsert(gu => gu.Id, Guid.NewGuid().ToString())
                    .SetOnInsert(gu => gu.GroupId, group.Id)
                    .SetOnInsert(gu => gu.UserId, userId)
                    .Set(gu => gu.IsDeleted, false)
                    .Set(gu => gu.UpdatedAt, now)
                    .SetOnInsert(gu => gu.CreatedAt, now),
                new UpdateOptions { IsUpsert = true },
                ct);
        }

        logger.LogInformation("Fake status simulator seeded {Count} fake users into group {GroupName}", _options.UserCount, group.Name);
        return group;
    }

    private async Task UpdateFakeStatusesAsync(string groupId, CancellationToken ct)
    {
        var fakeUserIds = await _groupUsers.Find(gu => gu.GroupId == groupId && gu.IsDeleted != true)
            .Project(gu => gu.UserId)
            .ToListAsync(ct);

        if (fakeUserIds.Count == 0)
            return;

        var count = Math.Clamp(_options.UsersChangedPerTick, 1, fakeUserIds.Count);
        var selectedUserIds = fakeUserIds
            .Where(id => id.StartsWith("fake-fear-group-", StringComparison.Ordinal))
            .OrderBy(_ => _random.Next())
            .Take(count)
            .ToList();

        await using var scope = scopeFactory.CreateAsyncScope();
        var statusService = scope.ServiceProvider.GetRequiredService<IUserStatusService>();

        foreach (var userId in selectedUserIds)
        {
            var status = PickStatus();
            var user = await _users
                .Find(u => u.Id == userId && u.IsFake == true && u.IsDeleted != true)
                .FirstOrDefaultAsync(ct);

            if (user is null)
                continue;

            await statusService.ChangeStatusAsync(user.Id, status, UserStatusChangeSource.FakeSimulator, ct);
        }
    }

    private UserStatus PickStatus()
    {
        var roll = _random.Next(100);
        return roll switch
        {
            < 55 => UserStatus.Safe,
            < 75 => UserStatus.InShelter,
            < 90 => UserStatus.Unknown,
            _ => UserStatus.NeedHelp
        };
    }
}
