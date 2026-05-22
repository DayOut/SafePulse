using HeartPulse.DTOs;

namespace HeartPulse.Services.Interfaces;

public interface ITelegramLinkService
{
    Task<TelegramLinkCodeDto> CreateCodeAsync(string userId, CancellationToken ct);
    Task<TelegramLinkStatusDto?> GetStatusAsync(string codeId, string userId, CancellationToken ct);
    Task<string> ConsumeCodeAsync(string code, string telegramUserId, string telegramUserName, long chatId, CancellationToken ct);
}
