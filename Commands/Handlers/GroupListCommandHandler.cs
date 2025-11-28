using System.Text;
using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class GroupListCommandHandler(
    IGroupService groupService)
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
        sb.AppendLine("Твої групи:").AppendLine();
        
        foreach (var group in groups)
        {
            sb.AppendLine($"\\- {group.Name}" + (group.OwnerId == context.User.Id ? " \\(Власник\\)" : ""));
        }

        return new TelegramCommandResult(sb.ToString());
    }
}