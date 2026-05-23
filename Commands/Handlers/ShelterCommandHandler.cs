using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Services;

namespace HeartPulse.Commands.Handlers;

public class ShelterCommandHandler(
    TelegramStatusUpdateService statusUpdateService,
    IAppLocalizer localizer)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText is "В укритті" or "In shelter" or "/shelter";
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        var user = await statusUpdateService.UpdateAsync(context.User, UserStatus.InShelter, ct);

        return new TelegramCommandResult(localizer.Text("telegram.shelterSet", user?.Language ?? context.User.Language));
    }
}
