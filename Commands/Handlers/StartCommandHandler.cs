using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Localization;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class StartCommandHandler(
    IGroupService groupService,
    ITelegramLinkService telegramLinkService,
    IAppLocalizer localizer)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText.StartsWith("/start");
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        var parts = context.RawText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var lang = localizer.NormalizeLanguage(context.User.Language);

        if (parts.Length < 2)
            return new TelegramCommandResult(localizer.Text("telegram.start", lang));

        var payload = parts[1];

        if (payload.StartsWith("link_", StringComparison.OrdinalIgnoreCase))
        {
            var code = payload["link_".Length..];
            try
            {
                var userName = await telegramLinkService.ConsumeCodeAsync(
                    code, context.User.Id, context.User.UserName, context.ChatId, ct);
                return new TelegramCommandResult(localizer.Text("telegram.linked", lang, userName));
            }
            catch (InvalidOperationException ex)
            {
                return new TelegramCommandResult(ex.Message);
            }
        }

        var group = await groupService.GetByJoinPayloadAsync(payload, ct);
        if (group == null)
            return new TelegramCommandResult(localizer.Text("telegram.groupNotFound", lang));

        var userGroups = await groupService.GetUserGroupsAsync(context.User.Id, ct);
        if (userGroups.Any(g => g.Id == group.Id))
            return new TelegramCommandResult(localizer.Text("telegram.alreadyInGroup", lang));

        await groupService.JoinUserToGroupAsync(context.User, group.Id, ct);
        return new TelegramCommandResult(localizer.Text("telegram.joinedGroup", lang, group.Name));
    }
}
