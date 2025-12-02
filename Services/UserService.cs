using HeartPulse.Data;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;

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
        if (user is not null)
            return user;

        user = new AppUser
        {
            Id = userId,
            UserName = userName,
            LastActiveAt = DateTime.UtcNow,
            Status = UserStatus.Unknown,
            ChatId = chatId
        };

        await db.Users.AddAsync(user, ct);
        await db.SaveChangesAsync(ct);

        return user;
    }

    public async Task<AppUser?> GetAsync(string userId, string userName, long chatId, CancellationToken ct)
    {
        return await db.Users.FindAsync(new object?[] { userId }, ct);
    }

    public async Task UpdateStatusAsync(AppUser user, UserStatus status, CancellationToken ct)
    {
        user.Status = status;
        user.LastActiveAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }
}