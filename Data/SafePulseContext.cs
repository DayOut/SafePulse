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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Назви колекцій у Mongo
        modelBuilder.Entity<AppUser>().ToCollection("users");
        modelBuilder.Entity<Group>().ToCollection("groups");
        modelBuilder.Entity<GroupUser>().ToCollection("groupUsers");
    }
}