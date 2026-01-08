using System.Text;
using HeartPulse.Commands.Interfaces;
using HeartPulse.Controllers;
using HeartPulse.DTOs;
using HeartPulse.Formatters.Interfaces;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class ReferalListCommandHandler(
    IGroupService groupService,
    IGroupNotifier  groupNotifier,
    ITelegramTextFormatter formatter)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText is "/referal";
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
        
        foreach (var group in groups)
        {
            await groupNotifier.SendMessageAsync(formatter.FormatGroupLink(group), context.User, ct);
        }

        sb.AppendLine("Відправ одне з повідомлень вище тому кого ти хочеш додати до групи.");
        sb.AppendLine("Їм достатньо перейти по посиланню, щоб приєднатись до групи");
        return new TelegramCommandResult(sb.ToString());
    }
}