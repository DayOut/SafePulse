using HeartPulse.Data;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace HeartPulse.Services;

public class GroupService(SafePulseContext db) : IGroupService
{
    public async Task<IReadOnlyList<Group>> GetUserGroupsAsync(string userId, CancellationToken ct)
    {
        var groupIds = await db.GroupUsers
            .Where(gu => gu.UserId == userId)
            .Select(gu => gu.GroupId)
            .ToListAsync(ct); // Possible another implementation. From mongo not Entity framework

        if (groupIds.Count == 0)
            return Array.Empty<Group>();

        var groups = await db.Groups
            .Where(g => groupIds.Contains(g.Id))
            .ToListAsync(ct);

        return groups;
    }

    public async Task<bool> IsGroupNameExistAsync(string groupName, CancellationToken ct)
    {
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Name == groupName, ct);
        return group is not null;
    }

    public async Task<bool> IsGroupIdExistAsync(string groupId, CancellationToken ct)
    {
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Id == groupId, ct);
        return group is not null;
    }

    public async Task<Group> CreateAsync(string ownerId, string name, CancellationToken ct)
    {
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Name == name, ct);
        if (group is not null)
            throw new Exception("Group already exists");

        group = new Group
        {
            Id = Guid.NewGuid().ToString(),
            Name = name,
            OwnerId = ownerId
        };

        db.Groups.Add(group);
        await db.SaveChangesAsync(ct);
        return group;
    }

    public async Task JoinUserToGroupAsync(AppUser user, string groupId, CancellationToken ct)
    {
        var group = await db.Groups.FindAsync(new object?[] { groupId }, ct);
        if (group is null)
            throw new InvalidOperationException("Група не знайдена");

        var inGroup = await db.GroupUsers
            .AnyAsync(gu => gu.UserId == user.Id && gu.GroupId == group.Id, ct);

        if (!inGroup)
        {
            db.GroupUsers.Add(new GroupUser
            {
                Id = Guid.NewGuid().ToString(),
                UserId = user.Id,
                GroupId = group.Id
            });

            await db.SaveChangesAsync(ct);
        }
    }

    public async Task<Group?> GetByJoinPayloadAsync(string payload, CancellationToken ct)
    {
        if (!payload.StartsWith("join_", StringComparison.OrdinalIgnoreCase))
            return null;

        var groupId = payload["join_".Length..];

        return await db.Groups.FindAsync(new object?[] { groupId }, ct);
    }
}