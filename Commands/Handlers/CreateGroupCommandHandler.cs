using System.Text;
using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Options;
using HeartPulse.Services.Interfaces;
using Microsoft.Extensions.Options;

namespace HeartPulse.Commands.Handlers;

public class CreateGroupCommandHandler(
    IGroupService groupService,
    IGroupNotifier groupNotifier,
    IOptions<TelegramOptions> telegramOptions)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText.Contains("/create");
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        var namePart = context.RawText.Substring("/create".Length).Trim();
        var sb = new StringBuilder();
        
        if (string.IsNullOrWhiteSpace(namePart))
        {
            sb.Append("Будь ласка, надішли команду у форматі:\n/create Назва моєї групи");
            return new TelegramCommandResult(sb.ToString());
        }

        if (await groupService.IsGroupNameExistAsync(namePart, ct))
        {
            sb.Append("Така група вже існує");
            return new TelegramCommandResult(sb.ToString());
        }
        
        var group = await groupService.CreateAsync(context.User.Id, namePart, ct);
        await groupService.JoinUserToGroupAsync(context.User, group.Id, ct);
        var invite = await groupService.CreateInviteAsync(group.Id, context.User.Id, "Telegram invite", ct);
        
        var inviteLink = $"https://t.me/{telegramOptions.Value.BotUsername}?start=join_{invite.Token}";
        
        sb.AppendLine($"Група \"{group.Name}\" готова.\n" +
                      "Ти доданий до неї. Надішли це посилання іншим, щоб запросити їх:");
        
        await groupNotifier.SendMessageAsync(sb.ToString(), context.User, ct);
        sb.Clear();
        sb.Append($"Вас запросили в групу \"{group.Name}\" додатку SafePulse. \n<a href=\"{inviteLink}\">Приєднатись</a>");
        await groupNotifier.SendMessageAsync(sb.ToString(), context.User, ct);
        
        return new TelegramCommandResult(inviteLink);
    }
}
