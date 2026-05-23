using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Events;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class SafeCommandHandler(
    IUserStatusService userStatusService,
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
        var user = await userStatusService.ChangeStatusAsync(context.User.Id, UserStatus.Safe, UserStatusChangeSource.Telegram, ct);

        return new TelegramCommandResult(localizer.Text("telegram.safeSet", user?.Language ?? context.User.Language));
    }
}
