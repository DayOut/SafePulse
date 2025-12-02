using System.Text;
using HeartPulse.Commands.Interfaces;
using HeartPulse.Controllers;
using HeartPulse.DTOs;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class GroupListCommandHandler(
    IGroupService groupService,
    IGroupNotifier  groupNotifier)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText is "/group";
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        var groups = await groupService.GetUserGroupsAsync(context.User.Id, ct);
        var sb = new StringBuilder();
        if (groups.Count == 0)
        {
            sb.AppendLine("Список груп порожній");
            sb.AppendLine("Для їх створення ви можете використати команду /create");
            sb.AppendLine("Або приєднатись по посиланню від іншого користувача");
            return new TelegramCommandResult(sb.ToString());
        }

       
        sb.AppendLine("Твої групи:").AppendLine();
        
        foreach (var group in groups)
        {
            sb.AppendLine($"- {group.Name}" + (group.OwnerId == context.User.Id ? " (Власник)" : ""));
            var inviteLink = $"https://t.me/{TelegramController.BotUsername}?start=join_{group.Id}";
           
            var groupMess = "Твоє посилання на групу: ";
            groupMess += $"<a href=\"{inviteLink}\">{group.Name}</a>";
            await groupNotifier.SendMessageAsync(groupMess, context.User, ct);
        }

        return new TelegramCommandResult(sb.ToString());
    }
}