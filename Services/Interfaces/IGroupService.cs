using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface IGroupService
{
    Task<IReadOnlyList<Group>> GetUserGroupsAsync(string userId, CancellationToken ct);
    Task<IReadOnlyList<Group>> GetOwnedGroupsAsync(string ownerId, CancellationToken ct);
    Task<Group?> GetByIdAsync(string groupId, CancellationToken ct);
    Task<IReadOnlyList<AppUser>> GetGroupUsersAsync(string groupId, CancellationToken ct);
    Task<bool> IsGroupNameExistAsync(string groupName, CancellationToken ct);
    Task<bool> IsGroupIdExistAsync(string groupId, CancellationToken ct);
    Task<Group> CreateAsync(string ownerId, string name, CancellationToken ct);
    Task<Group?> UpdateAsync(string groupId, string ownerId, string? name, CancellationToken ct);
    Task<bool> SoftDeleteAsync(string groupId, string ownerId, CancellationToken ct);
    Task JoinUserToGroupAsync(AppUser user, string groupId, CancellationToken ct);
    Task<bool> RemoveUserFromGroupAsync(string groupId, string ownerId, string userId, CancellationToken ct);
    Task<GroupInvite> CreateInviteAsync(string groupId, string ownerId, string? note, CancellationToken ct);
    Task<IReadOnlyList<GroupInvite>> GetInvitesAsync(string groupId, string ownerId, CancellationToken ct);
    Task<bool> RevokeInviteAsync(string groupId, string ownerId, string inviteId, CancellationToken ct);
    Task<GroupInvite?> GetInviteByTokenAsync(string token, CancellationToken ct);
    Task<Group?> GetByJoinPayloadAsync(string payload, CancellationToken ct);
}
