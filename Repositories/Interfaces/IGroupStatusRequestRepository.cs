using HeartPulse.Models;

namespace HeartPulse.Repositories.Interfaces;

public interface IGroupStatusRequestRepository
{
    Task<GroupStatusRequest?> GetLatestForGroupAsync(string groupId, CancellationToken ct);
    Task InsertAsync(GroupStatusRequest request, CancellationToken ct);
}
