using HeartPulse.Models;

namespace HeartPulse.Data;

using MongoDB.Bson;
using MongoDB.Driver;

public static class MongoIndexConfigurator
{
    public static async Task ConfigureAsync(IMongoDatabase db)
    {
        await ConfigureUserIndexesAsync(db);
        await ConfigureGroupIndexesAsync(db);
        await ConfigureGroupUserIndexesAsync(db);
        await ConfigureGroupInviteIndexesAsync(db);
        await ConfigureRefreshSessionIndexesAsync(db);
        await ConfigureTelegramLinkCodeIndexesAsync(db);
        await ConfigureGroupStatusRequestIndexesAsync(db);
        await ConfigureTelegramStatusMessageIndexesAsync(db);
        await ConfigureEmailVerificationTokenIndexesAsync(db);
    }

    private static async Task ConfigureUserIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<AppUser>("users");
        await DropIndexIfExistsAsync(collection, "idx_users_telegram_chatid_unique");

        var keys = Builders<AppUser>.IndexKeys
            .Ascending(x => x.ChatId);

        var options = new CreateIndexOptions<AppUser>
        {
            Unique = true,
            Name = "idx_users_telegram_chatid_unique",
            PartialFilterExpression = new BsonDocument("ChatId", new BsonDocument("$type", "long"))
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
                }),
            new(
                Builders<AppUser>.IndexKeys.Ascending(x => x.NormalizedEmail),
                new CreateIndexOptions<AppUser>
                {
                    Unique = true,
                    Name = "idx_users_normalizedEmail_unique",
                    PartialFilterExpression = new BsonDocument("NormalizedEmail", new BsonDocument("$type", "string"))
                }),
            new(
                Builders<AppUser>.IndexKeys.Ascending(x => x.IsFake),
                new CreateIndexOptions
                {
                    Name = "idx_users_isFake"
                }),
            new(
                Builders<AppUser>.IndexKeys.Ascending(x => x.TelegramUserId),
                new CreateIndexOptions<AppUser>
                {
                    Unique = true,
                    Name = "idx_users_telegramUserId_unique",
                    PartialFilterExpression = new BsonDocument("TelegramUserId", new BsonDocument("$type", "string"))
                })
        };

        await collection.Indexes.CreateManyAsync(indexes);
    }

    private static async Task ConfigureEmailVerificationTokenIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<EmailVerificationToken>("emailVerificationTokens");
        var indexes = new List<CreateIndexModel<EmailVerificationToken>>
        {
            new(
                Builders<EmailVerificationToken>.IndexKeys.Ascending(x => x.TokenHash),
                new CreateIndexOptions { Unique = true, Name = "idx_emailVerificationTokens_tokenHash_unique" }),
            new(
                Builders<EmailVerificationToken>.IndexKeys.Ascending(x => x.UserId),
                new CreateIndexOptions { Name = "idx_emailVerificationTokens_userId" }),
            new(
                Builders<EmailVerificationToken>.IndexKeys.Ascending(x => x.NormalizedEmail),
                new CreateIndexOptions { Name = "idx_emailVerificationTokens_normalizedEmail" }),
            new(
                Builders<EmailVerificationToken>.IndexKeys.Ascending(x => x.ExpiresAt),
                new CreateIndexOptions { Name = "idx_emailVerificationTokens_expiresAt" }),
        };
        await collection.Indexes.CreateManyAsync(indexes);
    }

    private static async Task DropIndexIfExistsAsync<T>(IMongoCollection<T> collection, string name)
    {
        try
        {
            await collection.Indexes.DropOneAsync(name);
        }
        catch (MongoCommandException ex) when (ex.CodeName == "IndexNotFound")
        {
        }
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

    private static async Task ConfigureRefreshSessionIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<RefreshSession>("refreshSessions");

        var indexes = new List<CreateIndexModel<RefreshSession>>
        {
            new(
                Builders<RefreshSession>.IndexKeys.Ascending(x => x.TokenHash),
                new CreateIndexOptions
                {
                    Unique = true,
                    Name = "idx_refreshSessions_tokenHash_unique"
                }),
            new(
                Builders<RefreshSession>.IndexKeys.Ascending(x => x.UserId),
                new CreateIndexOptions
                {
                    Name = "idx_refreshSessions_userId"
                }),
            new(
                Builders<RefreshSession>.IndexKeys.Ascending(x => x.ExpiresAt),
                new CreateIndexOptions
                {
                    Name = "idx_refreshSessions_expiresAt"
                })
        };

        await collection.Indexes.CreateManyAsync(indexes);
    }

    private static async Task ConfigureTelegramLinkCodeIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<TelegramLinkCode>("telegramLinkCodes");
        var indexes = new List<CreateIndexModel<TelegramLinkCode>>
        {
            new(
                Builders<TelegramLinkCode>.IndexKeys.Ascending(x => x.CodeHash),
                new CreateIndexOptions
                {
                    Unique = true,
                    Name = "idx_telegramLinkCodes_codeHash_unique"
                }),
            new(
                Builders<TelegramLinkCode>.IndexKeys.Ascending(x => x.UserId),
                new CreateIndexOptions
                {
                    Name = "idx_telegramLinkCodes_userId"
                }),
            new(
                Builders<TelegramLinkCode>.IndexKeys.Ascending(x => x.ExpiresAt),
                new CreateIndexOptions
                {
                    Name = "idx_telegramLinkCodes_expiresAt"
                })
        };

        await collection.Indexes.CreateManyAsync(indexes);
    }

    private static async Task ConfigureGroupStatusRequestIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<GroupStatusRequest>("groupStatusRequests");
        var indexes = new List<CreateIndexModel<GroupStatusRequest>>
        {
            new(
                Builders<GroupStatusRequest>.IndexKeys
                    .Ascending(x => x.GroupId)
                    .Descending(x => x.CreatedAt),
                new CreateIndexOptions
                {
                    Name = "idx_groupStatusRequests_groupId_createdAt"
                })
        };

        await collection.Indexes.CreateManyAsync(indexes);
    }

    private static async Task ConfigureTelegramStatusMessageIndexesAsync(IMongoDatabase db)
    {
        var collection = db.GetCollection<TelegramStatusMessage>("telegramStatusMessages");
        var indexes = new List<CreateIndexModel<TelegramStatusMessage>>
        {
            new(
                Builders<TelegramStatusMessage>.IndexKeys
                    .Ascending(x => x.ChatId)
                    .Ascending(x => x.GroupId)
                    .Ascending(x => x.ChunkIndex),
                new CreateIndexOptions
                {
                    Unique = true,
                    Name = "idx_telegramStatusMessages_chat_group_chunk_unique"
                })
        };

        await collection.Indexes.CreateManyAsync(indexes);
    }
}
