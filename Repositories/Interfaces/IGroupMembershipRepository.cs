using HeartPulse.Models;

namespace HeartPulse.Repositories.Interfaces;

public interface IGroupMembershipRepository
{
    Task<IReadOnlyList<string>> GetUserGroupIdsAsync(string userId, CancellationToken ct);
    Task<IReadOnlyList<GroupMemberInfo>> GetGroupMembersAsync(string groupId, CancellationToken ct);
    Task<IReadOnlyList<string>> GetMemberUserIdsAsync(IReadOnlyList<string> groupIds, CancellationToken ct);
}
