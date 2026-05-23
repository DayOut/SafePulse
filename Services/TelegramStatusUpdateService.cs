using HeartPulse.DTOs;
using HeartPulse.Hubs;
using HeartPulse.Models;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.SignalR;

namespace HeartPulse.Services;

public class TelegramStatusUpdateService(
    IUserService userService,
    IGroupService groupService,
    IGroupNotifier groupNotifier,
    IHubContext<StatusHub> statusHub,
    ILogger<TelegramStatusUpdateService> logger)
{
    public async Task<AppUser?> UpdateAsync(AppUser user, UserStatus status, CancellationToken ct)
    {
        var updatedUser = await userService.UpdateStatusAsync(user.Id, status, ct);
        if (updatedUser is null)
            return null;

        var groupIds = await groupService.GetUserGroupIdsAsync(updatedUser.Id, ct);
        if (groupIds.Count > 0)
        {
            await statusHub.Clients.Groups(groupIds).SendAsync("statusChanged", new StatusChangedDto
            {
                UserId = updatedUser.Id,
                UserName = updatedUser.UserName,
                Status = updatedUser.Status.ToString(),
                LastActiveAt = updatedUser.LastActiveAt,
                LastSeenOnlineAt = updatedUser.LastSeenOnlineAt ?? updatedUser.LastActiveAt,
                GroupIds = groupIds
            }, ct);
        }
        else
        {
            logger.LogInformation("Telegram status changed for user {UserId}, but no groups were found for realtime broadcast", updatedUser.Id);
        }

        await groupNotifier.NotifyStatusChangedAsync(updatedUser, ct);
        return updatedUser;
    }
}
