using HeartPulse.Models;
using HeartPulse.Repositories.Interfaces;
using MongoDB.Driver;

namespace HeartPulse.Repositories.Mongo;

public class MongoUserRepository(IMongoDatabase database) : IUserRepository
{
    private readonly IMongoCollection<AppUser> _users = database.GetCollection<AppUser>("users");

    public async Task<AppUser?> GetByIdAsync(string userId, CancellationToken ct)
    {
        var filter = Builders<AppUser>.Filter.And(
            Builders<AppUser>.Filter.Eq(u => u.Id, userId),
            Builders<AppUser>.Filter.Ne(u => u.IsDeleted, true));

        return await _users.Find(filter).FirstOrDefaultAsync(ct);
    }

    public async Task<AppUser?> UpdateStatusAsync(string userId, UserStatus status, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var filter = Builders<AppUser>.Filter.And(
            Builders<AppUser>.Filter.Eq(u => u.Id, userId),
            Builders<AppUser>.Filter.Ne(u => u.IsDeleted, true));

        var update = Builders<AppUser>.Update
            .Set(u => u.Status, status)
            .Set(u => u.LastActiveAt, now)
            .Set(u => u.LastSeenOnlineAt, now)
            .Set(u => u.UpdatedAt, now);

        return await _users.FindOneAndUpdateAsync(
            filter,
            update,
            new FindOneAndUpdateOptions<AppUser>
            {
                ReturnDocument = ReturnDocument.After
            },
            ct);
    }
}
