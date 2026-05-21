using HeartPulse.Models;

namespace HeartPulse.Data;

using MongoDB.Driver;

public static class MongoIndexConfigurator
{
    public static async Task ConfigureAsync(IMongoDatabase db)
    {
        await ConfigureUserIndexesAsync(db);
        await ConfigureGroupIndexesAsync(db);
        await ConfigureGroupUserIndexesAsync(db);
        await ConfigureGroupInviteIndexesAsync(db);
    }

    private static async Task ConfigureUserIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<AppUser>("users");

        var keys = Builders<AppUser>.IndexKeys
            .Ascending(x => x.ChatId);

        var options = new CreateIndexOptions
        {
            Unique = true,
            Name = "idx_users_telegram_chatid_unique"
        };

        var indexes = new List<CreateIndexModel<AppUser>>
        {
            new(keys, options),
            new(
                Builders<AppUser>.IndexKeys
                    .Ascending(x => x.IsDeleted)
                    .Descending(x => x.LastActiveAt),
                new CreateIndexOptions
                {
                    Name = "idx_users_active_lastActiveAt"
                })
        };

        await collection.Indexes.CreateManyAsync(indexes);
    }
    private static async Task ConfigureGroupIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<Group>("groups");

        var indexes = new List<CreateIndexModel<Group>>
        {
            new(
                Builders<Group>.IndexKeys.Ascending(x => x.Name),
                new CreateIndexOptions
                {
                    Name = "idx_groups_name"
                }),
            new(
                Builders<Group>.IndexKeys.Ascending(x => x.OwnerId),
                new CreateIndexOptions
                {
                    Name = "idx_groups_ownerId"
                })
        };

        await collection.Indexes.CreateManyAsync(indexes);
    }
    
    private static async Task ConfigureGroupUserIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<GroupUser>("groupUsers");

        var indexes = new List<CreateIndexModel<GroupUser>>();

        indexes.Add(new CreateIndexModel<GroupUser>(
            Builders<GroupUser>.IndexKeys
                .Ascending(x => x.UserId)
                .Ascending(x => x.GroupId),
            new CreateIndexOptions
            {
                Name = "idx_userId_groupId"
            }));
        
        indexes.Add(new CreateIndexModel<GroupUser>(
            Builders<GroupUser>.IndexKeys
                .Ascending(x => x.GroupId)
                .Ascending(x => x.UserId),
            new CreateIndexOptions
            {
                Name = "idx_groupId_userId"
            }));
        
        await collection.Indexes.CreateManyAsync(indexes);
    }

    private static async Task ConfigureGroupInviteIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<GroupInvite>("groupInvites");

        var indexes = new List<CreateIndexModel<GroupInvite>>
        {
            new(
                Builders<GroupInvite>.IndexKeys.Ascending(x => x.Token),
                new CreateIndexOptions
                {
                    Unique = true,
                    Name = "idx_groupInvites_token_unique"
                }),
            new(
                Builders<GroupInvite>.IndexKeys.Ascending(x => x.GroupId),
                new CreateIndexOptions
                {
                    Name = "idx_groupInvites_groupId"
                })
        };

        await collection.Indexes.CreateManyAsync(indexes);
    }
}
