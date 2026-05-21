using HeartPulse.Data;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;

namespace HeartPulse.Services;

public class GroupService(SafePulseContext db) : IGroupService
{
    public async Task<IReadOnlyList<Group>> GetUserGroupsAsync(string userId, CancellationToken ct)
    {
        var groupIds = await db.GroupUsers
            .Where(gu => gu.UserId == userId && !gu.IsDeleted)
            .Select(gu => gu.GroupId)
            .ToListAsync(ct); // Possible another implementation. From mongo not Entity framework

        if (groupIds.Count == 0)
            return Array.Empty<Group>();

        var groups = await db.Groups
            .Where(g => groupIds.Contains(g.Id) && !g.IsDeleted)
            .ToListAsync(ct);

        return groups;
    }

    public async Task<IReadOnlyList<Group>> GetOwnedGroupsAsync(string ownerId, CancellationToken ct)
    {
        return await db.Groups
            .Where(g => g.OwnerId == ownerId && !g.IsDeleted)
            .OrderBy(g => g.Name)
            .ToListAsync(ct);
    }

    public async Task<Group?> GetByIdAsync(string groupId, CancellationToken ct)
    {
        return await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && !g.IsDeleted, ct);
    }

    public async Task<IReadOnlyList<AppUser>> GetGroupUsersAsync(string groupId, CancellationToken ct)
    {
        var userIds = await db.GroupUsers
            .Where(gu => gu.GroupId == groupId && !gu.IsDeleted)
            .Select(gu => gu.UserId)
            .ToListAsync(ct);

        if (userIds.Count == 0)
            return Array.Empty<AppUser>();

        return await db.Users
            .Where(u => userIds.Contains(u.Id) && !u.IsDeleted)
            .OrderByDescending(u => u.LastActiveAt)
            .ToListAsync(ct);
    }

    public async Task<bool> IsGroupNameExistAsync(string groupName, CancellationToken ct)
    {
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Name == groupName && !g.IsDeleted, ct);
        return group is not null;
    }

    public async Task<bool> IsGroupIdExistAsync(string groupId, CancellationToken ct)
    {
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Id == groupId && !g.IsDeleted, ct);
        return group is not null;
    }

    public async Task<Group> CreateAsync(string ownerId, string name, CancellationToken ct)
    {
        var groupName = name.Trim();
        var group = await db.Groups.FirstOrDefaultAsync(g => g.Name == groupName && !g.IsDeleted, ct);
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
            .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerId == ownerId && !g.IsDeleted, ct);
        if (group is null)
            return null;

        if (!string.IsNullOrWhiteSpace(name))
        {
            var trimmedName = name.Trim();
            var nameExists = await db.Groups
                .AnyAsync(g => g.Id != groupId && g.Name == trimmedName && !g.IsDeleted, ct);
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
        var group = await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerId == ownerId && !g.IsDeleted, ct);
        if (group is null)
            return false;

        var now = DateTime.UtcNow;
        group.IsDeleted = true;
        group.UpdatedAt = now;

        var memberships = await db.GroupUsers
            .Where(gu => gu.GroupId == groupId && !gu.IsDeleted)
            .ToListAsync(ct);

        foreach (var membership in memberships)
        {
            membership.IsDeleted = true;
            membership.UpdatedAt = now;
        }

        var invites = await db.GroupInvites
            .Where(i => i.GroupId == groupId && i.RevokedAt == null)
            .ToListAsync(ct);

        foreach (var invite in invites)
            invite.RevokedAt = now;

        await db.SaveChangesAsync(ct);
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
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });

            await db.SaveChangesAsync(ct);
            return;
        }

        if (!membership.IsDeleted)
            return;

        membership.IsDeleted = false;
        membership.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> RemoveUserFromGroupAsync(string groupId, string ownerId, string userId, CancellationToken ct)
    {
        var group = await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerId == ownerId && !g.IsDeleted, ct);
        if (group is null)
            return false;

        var membership = await db.GroupUsers
            .FirstOrDefaultAsync(gu => gu.GroupId == groupId && gu.UserId == userId && !gu.IsDeleted, ct);
        if (membership is null)
            return false;

        membership.IsDeleted = true;
        membership.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<GroupInvite> CreateInviteAsync(string groupId, string ownerId, string? note, CancellationToken ct)
    {
        var group = await db.Groups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.OwnerId == ownerId && !g.IsDeleted, ct);
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
            .AnyAsync(g => g.Id == groupId && g.OwnerId == ownerId && !g.IsDeleted, ct);
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
            .AnyAsync(g => g.Id == groupId && g.OwnerId == ownerId && !g.IsDeleted, ct);
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
