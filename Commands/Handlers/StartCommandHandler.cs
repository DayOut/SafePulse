using System.Text;
using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class StartCommandHandler(
    IGroupService groupService)
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
        var sb = new StringBuilder();
        if (parts.Length < 2)
        {
            return new TelegramCommandResult("Привіт! Я фіксую твій стан безпеки. Команди: /safe, /help, /shelter");
        }
        var groupName = parts[1];
        var group = await groupService.GetByJoinPayloadAsync(groupName, ct);
        if (group == null)
            return new TelegramCommandResult("Групу не знайдено");
        
        var userGroups = await groupService.GetUserGroupsAsync(context.User.Id, ct);
        if (userGroups.Contains(group))
            return new TelegramCommandResult("Ви вже в цій групі");
        
        await groupService.JoinUserToGroupAsync(context.User, group.Id, ct);

        sb.AppendLine($"Ти успішно приєднався до групи {group.Name}");
        
        return new TelegramCommandResult(sb.ToString());
    }
}