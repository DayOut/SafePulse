using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class LinkTelegramCommandHandler(ITelegramLinkService telegramLinkService) : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText.StartsWith("/link", StringComparison.OrdinalIgnoreCase);
    }

    public async Task<TelegramCommandResult?> HandleAsync(TelegramCommandContext context, CancellationToken ct)
    {
        var parts = context.RawText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2)
            return new TelegramCommandResult("Надішли команду у форматі: /link 123456");

        try
        {
            var userName = await telegramLinkService.ConsumeCodeAsync(
                parts[1],
                context.User.Id,
                context.User.UserName,
                context.ChatId,
                ct);

            return new TelegramCommandResult($"Telegram підключено до web акаунта {userName}.");
        }
        catch (InvalidOperationException ex)
        {
            return new TelegramCommandResult(ex.Message);
        }
    }
}
