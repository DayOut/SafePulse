using HeartPulse.Models;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Events;

public class ChatSystemMessageHandler(
    IGroupService groupService,
    IChatService chatService) : IUserStatusChangedEventHandler
{
    public async Task HandleAsync(UserStatusChangedEvent userEvent, CancellationToken ct)
    {
        var groupIds = await groupService.GetUserGroupIdsAsync(userEvent.User.Id, ct);
        if (groupIds.Count == 0)
            return;

        var status = userEvent.User.Status.ToString();
        await Task.WhenAll(groupIds.Select(groupId =>
            chatService.AddSystemMessageAsync(
                groupId,
                SystemEventType.StatusChanged,
                userEvent.User.Id,
                userEvent.User.UserName,
                status,
                ct)));
    }
}
