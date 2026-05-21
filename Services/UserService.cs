using HeartPulse.Data;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace HeartPulse.Services;

public class UserService(SafePulseContext db) : IUserService
{
    public async Task<AppUser> GetOrCreateAsync(
        string userId,
        string userName,
        long chatId,
        CancellationToken ct)
    {
        var user = await db.Users.FindAsync(new object?[] { userId }, ct);
        if (user is not null && !user.IsDeleted)
            return user;

        if (user is null)
        {
            user = new AppUser
            {
                Id = userId,
                CreatedAt = DateTime.UtcNow
            };

            await db.Users.AddAsync(user, ct);
        }

        user.UserName = userName;
        user.LastActiveAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;
        user.Status = UserStatus.Unknown;
        user.ChatId = chatId;
        user.IsDeleted = false;

        await db.SaveChangesAsync(ct);

        return user;
    }

    public async Task<AppUser?> GetAsync(string userId, string userName, long chatId, CancellationToken ct)
    {
        return await db.Users
            .FirstOrDefaultAsync(u => u.Id == userId && !u.IsDeleted, ct);
    }

    public async Task<IReadOnlyList<AppUser>> GetAllAsync(CancellationToken ct)
    {
        return await db.Users
            .Where(u => !u.IsDeleted)
            .OrderByDescending(u => u.LastActiveAt)
            .ToListAsync(ct);
    }

    public async Task<AppUser?> GetByIdAsync(string userId, CancellationToken ct)
    {
        return await db.Users
            .FirstOrDefaultAsync(u => u.Id == userId && !u.IsDeleted, ct);
    }

    public async Task<AppUser> CreateAsync(string? id, string userName, long? chatId, UserStatus status, CancellationToken ct)
    {
        var userId = string.IsNullOrWhiteSpace(id) ? Guid.NewGuid().ToString() : id.Trim();
        var existing = await db.Users.FindAsync(new object?[] { userId }, ct);
        if (existing is not null && !existing.IsDeleted)
            throw new InvalidOperationException("User already exists");

        var now = DateTime.UtcNow;
        var user = existing ?? new AppUser
        {
            Id = userId,
            CreatedAt = now
        };

        user.UserName = userName.Trim();
        user.ChatId = chatId;
        user.Status = status;
        user.LastActiveAt = now;
        user.UpdatedAt = now;
        user.IsDeleted = false;

        if (existing is null)
            await db.Users.AddAsync(user, ct);

        await db.SaveChangesAsync(ct);

        return user;
    }

    public async Task<AppUser?> UpdateAsync(string userId, string? userName, long? chatId, UserStatus? status, CancellationToken ct)
    {
        var user = await GetByIdAsync(userId, ct);
        if (user is null)
            return null;

        if (!string.IsNullOrWhiteSpace(userName))
            user.UserName = userName.Trim();

        if (chatId.HasValue)
            user.ChatId = chatId;

        if (status.HasValue)
            user.Status = status.Value;

        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return user;
    }

    public async Task<bool> SoftDeleteAsync(string userId, CancellationToken ct)
    {
        var user = await GetByIdAsync(userId, ct);
        if (user is null)
            return false;

        user.IsDeleted = true;
        user.UpdatedAt = DateTime.UtcNow;

        var memberships = await db.GroupUsers
            .Where(gu => gu.UserId == userId && !gu.IsDeleted)
            .ToListAsync(ct);

        foreach (var membership in memberships)
        {
            membership.IsDeleted = true;
            membership.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task UpdateStatusAsync(AppUser user, UserStatus status, CancellationToken ct)
    {
        user.Status = status;
        user.LastActiveAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }
}
