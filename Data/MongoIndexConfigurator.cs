using HeartPulse.Models;

namespace HeartPulse.Data;

using MongoDB.Driver;

public static class MongoIndexConfigurator
{
    public static async Task ConfigureAsync(IMongoDatabase db)
    {
        await ConfigureUserIndexesAsync(db);
        // await ConfigureGroupIndexesAsync(db);
        await ConfigureGroupUserIndexesAsync(db);
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

        var model = new CreateIndexModel<AppUser>(keys, options);
        await collection.Indexes.CreateOneAsync(model);
    }
    
    // private static Task ConfigureGroupIndexesAsync(IMongoDatabase db)
    // {
    //     var collection = db.GetCollection<Group>("groups");
    //     
    //     var indexes = new List<CreateIndexModel<Group>>();
    //     
    //     indexes.Add(new CreateIndexModel<Group>(
    //         Builders<Group>.IndexKeys.Ascending(x => x.Id),
    //         new CreateIndexOptions
    //         {
    //             Unique = true,
    //             Name = "idx_users_telegram_chatid_unique"
    //         }));
    //     
    //     await collection.Indexes.CreateManyAsync(indexes);
    // }
    
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
}