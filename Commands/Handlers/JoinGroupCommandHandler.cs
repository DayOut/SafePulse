using System.Text;
using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class JoinGroupCommandHandler(
    IUserService userService,
    IGroupService groupService)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText.Contains("/join");
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        var parts = context.RawText.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var sb = new StringBuilder();
        if (parts.Length < 2)
        {
            return new TelegramCommandResult("Будь ласка, надішли команду у форматі: /join ID_групи");
        }
        
        var groupId = parts[1].Trim();

        if (await groupService.IsGroupIdExistAsync(groupId, ct))
            return new TelegramCommandResult("Групу з таким ID не знайдено\\. Перевір, чи правильно скопійовано код");
        
        var groups = await groupService.GetUserGroupsAsync(context.User.Id, ct);
        if (groups.Select(g => g.Id == groupId).Any())
            return new TelegramCommandResult("Ви вже в цій групі");
        
        await groupService.JoinUserToGroupAsync(context.User, groupId, ct);
        
        return new TelegramCommandResult($"Ти приєднався до групи {groupId}.");
    }
}