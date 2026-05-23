using HeartPulse.Models;
using HeartPulse.Repositories.Interfaces;
using MongoDB.Driver;

namespace HeartPulse.Repositories.Mongo;

public class MongoGroupStatusRequestRepository(IMongoDatabase database) : IGroupStatusRequestRepository
{
    private readonly IMongoCollection<GroupStatusRequest> _requests = database.GetCollection<GroupStatusRequest>("groupStatusRequests");

    public async Task<GroupStatusRequest?> GetLatestForGroupAsync(string groupId, CancellationToken ct)
    {
        return await _requests.Find(request => request.GroupId == groupId)
            .SortByDescending(request => request.CreatedAt)
            .FirstOrDefaultAsync(ct);
    }

    public Task InsertAsync(GroupStatusRequest request, CancellationToken ct)
    {
        return _requests.InsertOneAsync(request, cancellationToken: ct);
    }
}
