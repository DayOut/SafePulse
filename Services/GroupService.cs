using HeartPulse.Data;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;
using System.Security.Cryptography;

namespace HeartPulse.Services;

public class GroupService(SafePulseContext db, IMongoDatabase mongoDatabase) : IGroupService
{
    private readonly IMongoCollection<Group> _groups = mongoDatabase.GetCollection<Group>("groups");
    private readonly IMongoCollection<GroupUser> _groupUsers = mongoDatabase.GetCollection<GroupUser>("groupUsers");
    private readonly IMongoCollection<GroupInvite> _groupInvites = mongoDatabase.GetCollection<GroupInvite>("groupInvites");

    public async Task<IReadOnlyList<Group>> GetUserGroupsAsync(string userId, CancellationToken ct)
    {
        var groupIds = await db.GroupUsers
            .Where(gu => gu.UserId == userId && gu.IsDeleted != true)
            .Select(gu => gu.GroupId)
            .ToListAsync(ct); // Possible another implementation. From mongo not Entity framework

        var distinctGroupIds = groupIds.Distinct().ToList();
        var groups = await db.Groups
            .Where(g => (distinctGroupIds.Contains(g.Id) || g.OwnerId == userId) && g.IsDeleted != true)
            .ToListAsync(ct);

        return groups;
    }

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

    public async Task<IReadOnlyList<Group>> GetOwnedGroupsAsync(string ownerId, CancellationToken ct)
    {
        return await db.Groups
            .Where(g => g.OwnerId == ownerId && g.IsDeleted != true)
            .OrderBy(g => g.Name)
            .ToListAsync(ct);
    }

    public async Task<Group?> GetByIdAsync(string groupId, CancellationToken ct)
    {
        return await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.IsDeleted != true, ct);
    }

    public async Task<IReadOnlyList<AppUser>> GetGroupUsersAsync(string groupId, CancellationToken ct)
    {
        var members = await GetGroupMembersAsync(groupId, ct);
        return members.Select(m => m.User).ToList();
    }

    public async Task<IReadOnlyList<GroupMemberInfo>> GetGroupMembersAsync(string groupId, CancellationToken ct)
    {
        var group = await GetByIdAsync(groupId, ct);
        if (group is null)
            return Array.Empty<GroupMemberInfo>();

        var memberships = await db.GroupUsers
            .Where(gu => gu.GroupId == groupId && gu.IsDeleted != true)
            .ToListAsync(ct);

        var userIds = memberships.Select(gu => gu.UserId).Distinct().ToList();
        if (!userIds.Contains(group.OwnerId))
            userIds.Add(group.OwnerId);

        if (userIds.Count == 0)
            return Array.Empty<GroupMemberInfo>();

        var users = await db.Users
            .Where(u => userIds.Contains(u.Id) && u.IsDeleted != true)
            .OrderByDescending(u => u.LastActiveAt)
            .ToListAsync(ct);

        var roleByUserId = memberships
            .GroupBy(gu => gu.UserId)
            .ToDictionary(grouping => grouping.Key, grouping => grouping.First().Role ?? GroupUserRole.Member);
        return users
            .Select(user => new GroupMemberInfo(
                user,
                user.Id == group.OwnerId
                    ? "Owner"
                    : roleByUserId.GetValueOrDefault(user.Id, GroupUserRole.Member)))
            .ToList();
    }

    public async Task<bool> IsUserInGroupAsync(string groupId, string userId, CancellationToken ct)
    {
        return await db.GroupUsers
            .AnyAsync(gu => gu.GroupId == groupId && gu.UserId == userId && gu.IsDeleted != true, ct);
    }

    public async Task<bool> CanManageMembersAsync(string groupId, string userId, CancellationToken ct)
    {
        var group = await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.IsDeleted != true, ct);
        if (group is null)
            return false;

        if (group.OwnerId == userId)
            return true;

        return await db.GroupUsers.AnyAsync(gu =>
            gu.GroupId == groupId &&
            gu.UserId == userId &&
            gu.Role == GroupUserRole.Admin &&
            gu.IsDeleted != true,
            ct);
    }

    public async Task<bool> IsGroupNameExistAsync(string groupName, CancellationToken ct)
    {
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Name == groupName && g.IsDeleted != true, ct);
        return group is not null;
    }

    public async Task<bool> IsGroupIdExistAsync(string groupId, CancellationToken ct)
    {
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Id == groupId && g.IsDeleted != true, ct);
        return group is not null;
    }

    public async Task<Group> CreateAsync(string ownerId, string name, CancellationToken ct)
    {
        var groupName = name.Trim();
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Name == groupName && g.IsDeleted != true, ct);
        if (group is not null)
            throw new Exception("Group already exists");

        var now = DateTime.UtcNow;
        group = new Group
        {
            Id = Guid.NewGuid().ToString(),
            Name = groupName,
            OwnerId = ownerId,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.Groups.Add(group);
        await db.SaveChangesAsync(ct);
        return group;
    }

    public async Task<Group?> UpdateAsync(string groupId, string ownerId, string? name, CancellationToken ct)
    {
        var group = await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerId == ownerId && g.IsDeleted != true, ct);
        if (group is null)
            return null;

        if (!string.IsNullOrWhiteSpace(name))
        {
            var trimmedName = name.Trim();
            var nameExists = await db.Groups
                .AnyAsync(g => g.Id != groupId && g.Name == trimmedName && g.IsDeleted != true, ct);
            if (nameExists)
                throw new InvalidOperationException("Group already exists");

            group.Name = trimmedName;
        }

        group.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return group;
    }

    public async Task<bool> SoftDeleteAsync(string groupId, string ownerId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var groupResult = await _groups.UpdateOneAsync(
            g => g.Id == groupId && g.OwnerId == ownerId && g.IsDeleted != true,
            Builders<Group>.Update
                .Set(g => g.IsDeleted, true)
                .Set(g => g.UpdatedAt, now),
            cancellationToken: ct);

        if (groupResult.ModifiedCount == 0)
            return false;

        await _groupUsers.UpdateManyAsync(
            gu => gu.GroupId == groupId && gu.IsDeleted != true,
            Builders<GroupUser>.Update
                .Set(gu => gu.IsDeleted, true)
                .Set(gu => gu.UpdatedAt, now),
            cancellationToken: ct);

        await _groupInvites.UpdateManyAsync(
            i => i.GroupId == groupId && i.RevokedAt == null,
            Builders<GroupInvite>.Update.Set(i => i.RevokedAt, now),
            cancellationToken: ct);

        return true;
    }

    public async Task JoinUserToGroupAsync(AppUser user, string groupId, CancellationToken ct)
    {
        var group = await GetByIdAsync(groupId, ct);
        if (group is null)
            throw new InvalidOperationException("Група не знайдена");

        var membership = await db.GroupUsers
            .FirstOrDefaultAsync(gu => gu.UserId == user.Id && gu.GroupId == group.Id, ct);

        if (membership is null)
        {
            db.GroupUsers.Add(new GroupUser
            {
                Id = Guid.NewGuid().ToString(),
                UserId = user.Id,
                GroupId = group.Id,
                Role = GroupUserRole.Member,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });

            await db.SaveChangesAsync(ct);
            return;
        }

        if (membership.IsDeleted != true)
            return;

        membership.IsDeleted = false;
        membership.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> RemoveUserFromGroupAsync(string groupId, string managerId, string userId, CancellationToken ct)
    {
        var group = await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.IsDeleted != true, ct);
        if (group is null)
            return false;

        if (group.OwnerId == userId)
            return false;

        var managerIsOwner = group.OwnerId == managerId;
        var managerMembership = managerIsOwner
            ? null
            : await db.GroupUsers.FirstOrDefaultAsync(gu =>
                gu.GroupId == groupId &&
                gu.UserId == managerId &&
                gu.Role == GroupUserRole.Admin &&
                gu.IsDeleted != true,
                ct);

        if (!managerIsOwner && managerMembership is null)
            return false;

        var membership = await db.GroupUsers
            .FirstOrDefaultAsync(gu => gu.GroupId == groupId && gu.UserId == userId && gu.IsDeleted != true, ct);
        if (membership is null)
            return false;

        if (!managerIsOwner && membership.Role == GroupUserRole.Admin)
            return false;

        membership.IsDeleted = true;
        membership.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> UpdateMemberRoleAsync(string groupId, string ownerId, string userId, string role, CancellationToken ct)
    {
        var normalizedRole = role.Trim();
        if (normalizedRole is not GroupUserRole.Member and not GroupUserRole.Admin)
            throw new InvalidOperationException("Role must be Member or Admin");

        var group = await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerId == ownerId && g.IsDeleted != true, ct);
        if (group is null || group.OwnerId == userId)
            return false;

        var membership = await db.GroupUsers
            .FirstOrDefaultAsync(gu => gu.GroupId == groupId && gu.UserId == userId && gu.IsDeleted != true, ct);
        if (membership is null)
            return false;

        membership.Role = normalizedRole;
        membership.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<GroupInvite> CreateInviteAsync(string groupId, string ownerId, string? note, CancellationToken ct)
    {
        var group = await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerId == ownerId && g.IsDeleted != true, ct);
        if (group is null)
            throw new InvalidOperationException("Group not found");

        var invite = new GroupInvite
        {
            Id = Guid.NewGuid().ToString(),
            Token = GenerateToken(),
            GroupId = groupId,
            CreatedByUserId = ownerId,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        await db.GroupInvites.AddAsync(invite, ct);
        await db.SaveChangesAsync(ct);
        return invite;
    }

    public async Task<IReadOnlyList<GroupInvite>> GetInvitesAsync(string groupId, string ownerId, CancellationToken ct)
    {
        var ownsGroup = await db.Groups
            .AnyAsync(g => g.Id == groupId && g.OwnerId == ownerId && g.IsDeleted != true, ct);
        if (!ownsGroup)
            return Array.Empty<GroupInvite>();

        return await db.GroupInvites
            .Where(i => i.GroupId == groupId)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task<bool> RevokeInviteAsync(string groupId, string ownerId, string inviteId, CancellationToken ct)
    {
        var ownsGroup = await db.Groups
            .AnyAsync(g => g.Id == groupId && g.OwnerId == ownerId && g.IsDeleted != true, ct);
        if (!ownsGroup)
            return false;

        var invite = await db.GroupInvites
            .FirstOrDefaultAsync(i => i.Id == inviteId && i.GroupId == groupId && i.RevokedAt == null, ct);
        if (invite is null)
            return false;

        invite.RevokedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<GroupInvite?> GetInviteByTokenAsync(string token, CancellationToken ct)
    {
        return await db.GroupInvites
            .FirstOrDefaultAsync(i => i.Token == token, ct);
    }

    public async Task<Group?> GetByJoinPayloadAsync(string payload, CancellationToken ct)
    {
        if (!payload.StartsWith("join_", StringComparison.OrdinalIgnoreCase))
            return null;

        var tokenOrGroupId = payload["join_".Length..];

        var invite = await GetInviteByTokenAsync(tokenOrGroupId, ct);
        if (invite is not null)
        {
            if (invite.RevokedAt is not null)
                return null;

            return await GetByIdAsync(invite.GroupId, ct);
        }

        return await GetByIdAsync(tokenOrGroupId, ct);
    }

    private static string GenerateToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
