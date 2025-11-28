using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface IGroupService
{
    Task<IReadOnlyList<Group>> GetUserGroupsAsync(string userId, CancellationToken ct);
    Task<bool> IsGroupNameExistAsync(string groupName, CancellationToken ct);
    Task<bool> IsGroupIdExistAsync(string groupId, CancellationToken ct);
    Task<Group> CreateAsync(string ownerId, string name, CancellationToken ct);
    Task JoinUserToGroupAsync(AppUser user, string groupId, CancellationToken ct);
    Task<Group?> GetByJoinPayloadAsync(string payload, CancellationToken ct);
}