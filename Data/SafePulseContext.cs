using HeartPulse.Models;
using Microsoft.EntityFrameworkCore;
using MongoDB.EntityFrameworkCore.Extensions;

namespace HeartPulse.Data;

public class SafePulseContext : DbContext
{
    public SafePulseContext(DbContextOptions<SafePulseContext> options) : base(options) { }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<GroupUser> GroupUsers => Set<GroupUser>();
    public DbSet<GroupInvite> GroupInvites => Set<GroupInvite>();
    public DbSet<RefreshSession> RefreshSessions => Set<RefreshSession>();
    public DbSet<TelegramLinkCode> TelegramLinkCodes => Set<TelegramLinkCode>();
    public DbSet<GroupStatusRequest> GroupStatusRequests => Set<GroupStatusRequest>();
    public DbSet<EmailVerificationToken> EmailVerificationTokens => Set<EmailVerificationToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Назви колекцій у Mongo
        modelBuilder.Entity<AppUser>().ToCollection("users");
        modelBuilder.Entity<Group>().ToCollection("groups");
        modelBuilder.Entity<GroupUser>().ToCollection("groupUsers");
        modelBuilder.Entity<GroupInvite>().ToCollection("groupInvites");
        modelBuilder.Entity<RefreshSession>().ToCollection("refreshSessions");
        modelBuilder.Entity<TelegramLinkCode>().ToCollection("telegramLinkCodes");
        modelBuilder.Entity<GroupStatusRequest>().ToCollection("groupStatusRequests");
        modelBuilder.Entity<EmailVerificationToken>().ToCollection("emailVerificationTokens");
    }
}
