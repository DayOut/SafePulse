using HeartPulse.DTOs;
using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface ITelegramLinkService
{
    Task<TelegramLinkCodeDto> CreateCodeAsync(string userId, CancellationToken ct);
    Task<TelegramLinkStatusDto?> GetStatusAsync(string codeId, string userId, CancellationToken ct);
    Task<string> ConsumeCodeAsync(string code, string telegramUserId, string telegramUserName, long chatId, CancellationToken ct);
    Task<AppUser?> DisconnectAsync(string userId, CancellationToken ct);
}
