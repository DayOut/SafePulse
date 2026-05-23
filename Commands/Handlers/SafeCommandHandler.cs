using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Services;

namespace HeartPulse.Commands.Handlers;

public class SafeCommandHandler(
    TelegramStatusUpdateService statusUpdateService,
    IAppLocalizer localizer)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText is "В безпеці" or "Safe" or "/safe";
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        var user = await statusUpdateService.UpdateAsync(context.User, UserStatus.Safe, ct);

        return new TelegramCommandResult(localizer.Text("telegram.safeSet", user?.Language ?? context.User.Language));
    }
}
