using HeartPulse.DTOs;
using HeartPulse.Events;
using HeartPulse.Hubs;
using HeartPulse.Repositories.Interfaces;
using Microsoft.AspNetCore.SignalR;

namespace HeartPulse.Notifiers;

public class SignalRUserNotifier(
    IGroupMembershipRepository memberships,
    IHubContext<StatusHub> statusHub,
    ILogger<SignalRUserNotifier> logger) : IUserStatusChangedEventHandler
{
    public async Task HandleAsync(UserStatusChangedEvent userEvent, CancellationToken ct)
    {
        var user = userEvent.User;
        var groupIds = await memberships.GetUserGroupIdsAsync(user.Id, ct);
        if (groupIds.Count == 0)
        {
            logger.LogInformation(
                "Status changed for user {UserId}, but no groups were found for realtime broadcast",
                user.Id);
            return;
        }

        var memberUserIds = await memberships.GetMemberUserIdsAsync(groupIds, ct);
        var userChannels = memberUserIds.Select(id => $"user:{id}").ToList();

        await statusHub.Clients.Groups(userChannels).SendAsync("statusChanged", new StatusChangedDto
        {
            UserId = user.Id,
            UserName = user.UserName,
            Status = user.Status.ToString(),
            LastActiveAt = user.LastActiveAt,
            LastSeenOnlineAt = user.LastSeenOnlineAt ?? user.LastActiveAt,
            GroupIds = groupIds
        }, ct);
    }
}
