using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace HeartPulse.Hubs;

[Authorize]
public class StatusHub(
    IGroupService groupService,
    IUserService userService,
    IWebPresenceTracker presenceTracker) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var userId = Context.User?.GetUserId();
        if (userId is not null)
        {
            presenceTracker.Connected(userId, Context.ConnectionId);
            await userService.TouchLastSeenOnlineAsync(userId, Context.ConnectionAborted);
        }

        await base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = Context.User?.GetUserId();
        if (userId is not null)
            presenceTracker.Disconnected(userId, Context.ConnectionId);

        return base.OnDisconnectedAsync(exception);
    }

    public async Task JoinUserGroups()
    {
        var userId = Context.User?.GetUserId();
        if (userId is null)
            throw new HubException("Unauthorized");

        presenceTracker.Connected(userId, Context.ConnectionId);
        await userService.TouchLastSeenOnlineAsync(userId, Context.ConnectionAborted);

        var groups = await groupService.GetUserGroupsAsync(userId, Context.ConnectionAborted);
        foreach (var group in groups)
            await Groups.AddToGroupAsync(Context.ConnectionId, group.Id, Context.ConnectionAborted);
    }
}
