using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace HeartPulse.Hubs;

[Authorize]
public class StatusHub(IGroupService groupService, IUserService userService) : Hub
{
    public async Task JoinUserGroups()
    {
        var userId = Context.User?.GetUserId();
        if (userId is null)
            throw new HubException("Unauthorized");

        await userService.TouchLastSeenOnlineAsync(userId, Context.ConnectionAborted);

        var groups = await groupService.GetUserGroupsAsync(userId, Context.ConnectionAborted);
        foreach (var group in groups)
            await Groups.AddToGroupAsync(Context.ConnectionId, group.Id, Context.ConnectionAborted);
    }
}
