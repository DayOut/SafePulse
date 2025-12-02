using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class ShelterCommandHandler(
    IUserService userService,
    IGroupNotifier groupNotifier)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText is "В укритті" or "/shelter";
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        await userService.UpdateStatusAsync(context.User, UserStatus.InShelter, ct);
        await groupNotifier.NotifyStatusChangedAsync(context.User, ct);

        return new TelegramCommandResult("🏠 Відмічено: в укритті");
    }
}