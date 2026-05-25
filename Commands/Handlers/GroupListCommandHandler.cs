using System.Text;
using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Formatters;
using HeartPulse.Formatters.Interfaces;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class GroupListCommandHandler(
    IGroupService groupService,
    ITelegramTextFormatter formatter)
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
            var members = await groupService.GetGroupMembersAsync(group.Id, ct);
            sb.AppendLine(group.Name + (group.OwnerId == context.User.Id ? " (Власник)" : ""));
            if (members.Count == 0)
            {
                sb.AppendLine("- У групі поки немає учасників");
                sb.AppendLine();
                continue;
            }

            foreach (var member in members.OrderByDescending(member => member.User.LastActiveAt))
            {
                var userName = member.User.UserName ?? member.User.Id;
                var time = member.User.LastActiveAt.ToHumanTime();
                var role = member.Role == "Owner" ? " · owner" : "";
                sb.AppendLine($"- {userName}: {formatter.FormatStatus(member.User.Status)} ({time}){role}");
            }

            sb.AppendLine();
        }

        return new TelegramCommandResult(sb.ToString());
    }
}
