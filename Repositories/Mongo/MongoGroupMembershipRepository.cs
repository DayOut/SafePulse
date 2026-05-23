using HeartPulse.Models;
using HeartPulse.Repositories.Interfaces;
using MongoDB.Driver;

namespace HeartPulse.Repositories.Mongo;

public class MongoGroupMembershipRepository(IMongoDatabase database) : IGroupMembershipRepository
{
    private readonly IMongoCollection<AppUser> _users = database.GetCollection<AppUser>("users");
    private readonly IMongoCollection<Group> _groups = database.GetCollection<Group>("groups");
    private readonly IMongoCollection<GroupUser> _groupUsers = database.GetCollection<GroupUser>("groupUsers");

    public async Task<IReadOnlyList<string>> GetUserGroupIdsAsync(string userId, CancellationToken ct)
    {
        var filter = Builders<GroupUser>.Filter.And(
            Builders<GroupUser>.Filter.Eq(gu => gu.UserId, userId),
            Builders<GroupUser>.Filter.Ne(gu => gu.IsDeleted, true));

        var memberGroupIds = await _groupUsers.Find(filter)
            .Project(gu => gu.GroupId)
            .ToListAsync(ct);

        var ownedGroupIds = await _groups.Find(g => g.OwnerId == userId && g.IsDeleted != true)
            .Project(g => g.Id)
            .ToListAsync(ct);

        return memberGroupIds
            .Concat(ownedGroupIds)
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    public async Task<IReadOnlyList<GroupMemberInfo>> GetGroupMembersAsync(string groupId, CancellationToken ct)
    {
        var group = await _groups.Find(g => g.Id == groupId && g.IsDeleted != true)
            .FirstOrDefaultAsync(ct);
        if (group is null)
            return [];

        var memberships = await _groupUsers
            .Find(gu => gu.GroupId == groupId && gu.IsDeleted != true)
            .ToListAsync(ct);

        var userIds = memberships.Select(gu => gu.UserId).Distinct().ToList();
        if (!userIds.Contains(group.OwnerId))
            userIds.Add(group.OwnerId);

        if (userIds.Count == 0)
            return [];

        var users = await _users
            .Find(user => userIds.Contains(user.Id) && user.IsDeleted != true)
            .ToListAsync(ct);

        var usersById = users.ToDictionary(user => user.Id);
        var roleByUserId = memberships
            .GroupBy(gu => gu.UserId)
            .ToDictionary(
                grouping => grouping.Key,
                grouping => string.IsNullOrWhiteSpace(grouping.First().Role) ? GroupUserRole.Member : grouping.First().Role);

        return users
            .OrderByDescending(user => user.LastActiveAt)
            .Select(user => new GroupMemberInfo(
                user,
                user.Id == group.OwnerId
                    ? "Owner"
                    : roleByUserId.GetValueOrDefault(user.Id) ?? GroupUserRole.Member))
            .ToList();
    }
}
