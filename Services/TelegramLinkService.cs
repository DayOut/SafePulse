using System.Security.Cryptography;
using System.Text;
using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;
using MongoDB.Driver;

namespace HeartPulse.Services;

public class TelegramLinkService(IMongoDatabase database) : ITelegramLinkService
{
    private readonly IMongoCollection<AppUser> _users = database.GetCollection<AppUser>("users");
    private readonly IMongoCollection<Group> _groups = database.GetCollection<Group>("groups");
    private readonly IMongoCollection<GroupUser> _groupUsers = database.GetCollection<GroupUser>("groupUsers");
    private readonly IMongoCollection<GroupInvite> _groupInvites = database.GetCollection<GroupInvite>("groupInvites");
    private readonly IMongoCollection<TelegramLinkCode> _codes = database.GetCollection<TelegramLinkCode>("telegramLinkCodes");

    public async Task<TelegramLinkCodeDto> CreateCodeAsync(string userId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var code = GenerateCode();
        var linkCode = new TelegramLinkCode
        {
            Id = Guid.NewGuid().ToString(),
            CodeHash = HashCode(code),
            UserId = userId,
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(10)
        };

        await _codes.InsertOneAsync(linkCode, cancellationToken: ct);
        return new TelegramLinkCodeDto
        {
            Id = linkCode.Id,
            Code = code,
            ExpiresAt = linkCode.ExpiresAt
        };
    }

    public async Task<TelegramLinkStatusDto?> GetStatusAsync(string codeId, string userId, CancellationToken ct)
    {
        var code = await _codes.Find(x => x.Id == codeId && x.UserId == userId)
            .FirstOrDefaultAsync(ct);
        if (code is null)
            return null;

        return new TelegramLinkStatusDto
        {
            Id = code.Id,
            IsConsumed = code.ConsumedAt is not null,
            IsExpired = code.ExpiresAt <= DateTime.UtcNow,
            ExpiresAt = code.ExpiresAt
        };
    }

    public async Task<string> ConsumeCodeAsync(string code, string telegramUserId, string telegramUserName, long chatId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var codeHash = HashCode(code.Trim());
        var linkCode = await _codes.Find(x => x.CodeHash == codeHash && x.ConsumedAt == null && x.ExpiresAt > now)
            .FirstOrDefaultAsync(ct);
        if (linkCode is null)
            throw new InvalidOperationException("Код недійсний або застарів");

        var webUser = await _users.Find(u => u.Id == linkCode.UserId && u.IsDeleted != true)
            .FirstOrDefaultAsync(ct);
        if (webUser is null)
            throw new InvalidOperationException("Web account was not found");

        var telegramUser = await _users.Find(u =>
                u.Id == telegramUserId ||
                u.TelegramUserId == telegramUserId ||
                u.ChatId == chatId)
            .FirstOrDefaultAsync(ct);

        await MergeTelegramUserIntoWebUserAsync(webUser, telegramUser, telegramUserId, telegramUserName, chatId, now, ct);

        await _codes.UpdateOneAsync(
            x => x.Id == linkCode.Id,
            Builders<TelegramLinkCode>.Update.Set(x => x.ConsumedAt, now),
            cancellationToken: ct);

        return webUser.UserName;
    }

    private async Task MergeTelegramUserIntoWebUserAsync(
        AppUser webUser,
        AppUser? telegramUser,
        string telegramUserId,
        string telegramUserName,
        long chatId,
        DateTime now,
        CancellationToken ct)
    {
        var telegramSourceId = telegramUser?.Id;

        if (telegramUser is not null && telegramUser.Id != webUser.Id)
        {
            if (telegramUser.LastActiveAt > webUser.LastActiveAt)
                webUser.Status = telegramUser.Status;

            webUser.LastActiveAt = Max(webUser.LastActiveAt, telegramUser.LastActiveAt);
            webUser.LastSeenOnlineAt = MaxNullable(webUser.LastSeenOnlineAt, telegramUser.LastSeenOnlineAt);
            webUser.Roles = (webUser.Roles ?? [])
                .Concat(telegramUser.Roles ?? [])
                .Distinct(StringComparer.Ordinal)
                .ToList();
        }

        webUser.TelegramUserId = telegramUserId;
        webUser.ChatId = chatId;
        webUser.LastSeenOnlineAt = MaxNullable(webUser.LastSeenOnlineAt, now);
        webUser.UpdatedAt = now;
        await _users.ReplaceOneAsync(u => u.Id == webUser.Id, webUser, cancellationToken: ct);

        if (string.IsNullOrWhiteSpace(telegramSourceId) || telegramSourceId == webUser.Id)
            return;

        var telegramMemberships = await _groupUsers.Find(gu => gu.UserId == telegramSourceId && gu.IsDeleted != true)
            .ToListAsync(ct);

        foreach (var membership in telegramMemberships)
        {
            var existing = await _groupUsers.Find(gu => gu.UserId == webUser.Id && gu.GroupId == membership.GroupId)
                .FirstOrDefaultAsync(ct);
            if (existing is null)
            {
                membership.UserId = webUser.Id;
                membership.UpdatedAt = now;
                await _groupUsers.ReplaceOneAsync(gu => gu.Id == membership.Id, membership, cancellationToken: ct);
                continue;
            }

            existing.IsDeleted = false;
            existing.Role = MergeRole(existing.Role, membership.Role);
            existing.UpdatedAt = now;
            await _groupUsers.ReplaceOneAsync(gu => gu.Id == existing.Id, existing, cancellationToken: ct);
            await _groupUsers.UpdateOneAsync(
                gu => gu.Id == membership.Id,
                Builders<GroupUser>.Update.Set(gu => gu.IsDeleted, true).Set(gu => gu.UpdatedAt, now),
                cancellationToken: ct);
        }

        await _groups.UpdateManyAsync(
            g => g.OwnerId == telegramSourceId,
            Builders<Group>.Update.Set(g => g.OwnerId, webUser.Id).Set(g => g.UpdatedAt, now),
            cancellationToken: ct);

        await _groupInvites.UpdateManyAsync(
            i => i.CreatedByUserId == telegramSourceId,
            Builders<GroupInvite>.Update.Set(i => i.CreatedByUserId, webUser.Id),
            cancellationToken: ct);

        await _users.UpdateOneAsync(
            u => u.Id == telegramSourceId,
            Builders<AppUser>.Update
                .Set(u => u.IsDeleted, true)
                .Set(u => u.UpdatedAt, now)
                .Set(u => u.ChatId, null)
                .Set(u => u.TelegramUserId, null),
            cancellationToken: ct);
    }

    private static string MergeRole(string? left, string? right)
    {
        return left == GroupUserRole.Admin || right == GroupUserRole.Admin
            ? GroupUserRole.Admin
            : GroupUserRole.Member;
    }

    private static DateTime Max(DateTime left, DateTime right) => left >= right ? left : right;

    private static DateTime? MaxNullable(DateTime? left, DateTime? right)
    {
        if (left is null)
            return right;
        if (right is null)
            return left;
        return left >= right ? left : right;
    }

    private static string GenerateCode()
    {
        return RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
    }

    private static string HashCode(string code)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code))).ToLowerInvariant();
    }
}
