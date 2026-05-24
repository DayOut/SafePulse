using HeartPulse.Commands;
using HeartPulse.Commands.Handlers;
using HeartPulse.Commands.Interfaces;
using HeartPulse.Events;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using HeartPulse.Data;
using HeartPulse.Formatters;
using HeartPulse.Formatters.Interfaces;
using HeartPulse.Hubs;
using HeartPulse.Localization;
using HeartPulse.Models;
using HeartPulse.Notifiers;
using HeartPulse.Notifiers.Builders;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Options;
using HeartPulse.Repositories.Interfaces;
using HeartPulse.Repositories.Mongo;
using HeartPulse.Services;
using HeartPulse.Services.Interfaces;
using MongoDB.Driver;
using Scalar.AspNetCore;
using Telegram.Bot;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using Serilog.Events;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, configuration) => configuration
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.EntityFrameworkCore", LogEventLevel.Warning)
    .ReadFrom.Configuration(context.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .WriteTo.Console(outputTemplate:
        "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext} {Message:lj}{NewLine}{Exception}"));

builder.Services.Configure<TelegramOptions>(builder.Configuration.GetSection("Telegram"));
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection("Auth"));
builder.Services.Configure<FakeStatusSimulatorOptions>(builder.Configuration.GetSection("FakeStatusSimulator"));
builder.Services.Configure<AppOptions>(builder.Configuration.GetSection("App"));
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection("Smtp"));
builder.Services.Configure<EmailVerificationOptions>(builder.Configuration.GetSection("EmailVerification"));

var mongoConn = builder.Configuration.GetValue<string>("Mongo:ConnectionString")!;
var mongoDb = builder.Configuration.GetValue<string>("Mongo:Database") ?? "safepulse";

builder.Services.AddDbContext<SafePulseContext>(opt =>
    opt.UseMongoDB(mongoConn, mongoDb));

builder.Services.AddSingleton<IMongoClient>(_ => new MongoClient(mongoConn));
builder.Services.AddSingleton(sp =>
{
    var client = sp.GetRequiredService<IMongoClient>();
    return client.GetDatabase(mongoDb);
});

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.PropertyNamingPolicy = null);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();
builder.Services.AddSignalR()
    .AddJsonProtocol(options => options.PayloadSerializerOptions.PropertyNamingPolicy = null);

var auth = builder.Configuration.GetSection("Auth").Get<AuthOptions>() ?? new AuthOptions();
if (string.IsNullOrWhiteSpace(auth.SigningKey))
    throw new InvalidOperationException("Auth:SigningKey is not configured");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = auth.Issuer,
            ValidateAudience = true,
            ValidAudience = auth.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(auth.SigningKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs/status"))
                    context.Token = accessToken;

                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddPolicy("WebUi", policy =>
    {
        policy.SetIsOriginAllowed(_ => true)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

builder.Services.AddSingleton<ITelegramBotClient>(sp =>
{
    var cfg = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<TelegramOptions>>().Value;
    return new TelegramBotClient(cfg.BotToken);
});

var services = builder.Services;
services.AddScoped<IEmailSender, MailKitEmailSender>();
services.AddScoped<IEmailVerificationService, EmailVerificationService>();
services.AddScoped<IUserService, UserService>();
services.AddScoped<IUserStatusService, UserStatusService>();
services.AddScoped<IGroupService, GroupService>();
services.AddScoped<IAuthService, AuthService>();
services.AddScoped<ITelegramLinkService, TelegramLinkService>();
services.AddSingleton<IAppLocalizer, JsonAppLocalizer>();
services.AddSingleton<IWebPresenceTracker, WebPresenceTracker>();
services.AddScoped<IUserRepository, MongoUserRepository>();
services.AddScoped<IGroupMembershipRepository, MongoGroupMembershipRepository>();
services.AddScoped<IGroupStatusRequestRepository, MongoGroupStatusRequestRepository>();
services.AddSingleton<IUserEventQueue, UserEventQueue>();
services.AddHostedService<UserEventWorker>();
services.AddScoped<IGroupNotificationBuilder, GroupNotificationBuilder>();
services.AddScoped<IGroupNotifier, TelegramGroupNotifier>();
services.AddScoped<IUserStatusChangedEventHandler, SignalRUserNotifier>();
services.AddScoped<IUserStatusChangedEventHandler, TelegramUserNotifier>();
services.AddScoped<ITelegramTextFormatter, TelegramTextFormatter>();
services.AddScoped<ITelegramCommandDispatcher, TelegramCommandDispatcher>();
services.AddHostedService<FakeStatusSimulatorHostedService>();

// Handlers
services.AddScoped<ITelegramCommandHandler, SafeCommandHandler>();
services.AddScoped<ITelegramCommandHandler, HelpCommandHandler>();
services.AddScoped<ITelegramCommandHandler, ShelterCommandHandler>();
services.AddScoped<ITelegramCommandHandler, GroupListCommandHandler>();
services.AddScoped<ITelegramCommandHandler, ReferalListCommandHandler>();
services.AddScoped<ITelegramCommandHandler, StartCommandHandler>();
services.AddScoped<ITelegramCommandHandler, CreateGroupCommandHandler>();
services.AddScoped<ITelegramCommandHandler, JoinGroupCommandHandler>();
services.AddScoped<ITelegramCommandHandler, LinkTelegramCommandHandler>();
services.AddScoped<ITelegramCommandHandler, LanguageCommandHandler>();
services.AddScoped<ITelegramCommandHandler, TelegramNotificationsCommandHandler>();
services.AddScoped<ITelegramCommandHandler, UnknownCommandHandler>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<IMongoDatabase>();
    await MongoIndexConfigurator.ConfigureAsync(db);

    var users = db.GetCollection<AppUser>("users");
    await users.Find(Builders<AppUser>.Filter.Ne(x => x.IsDeleted, true))
        .Sort(Builders<AppUser>.Sort.Descending(x => x.LastActiveAt))
        .Limit(1)
        .ToListAsync();
}

app.MapOpenApi();
app.MapScalarApiReference();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseSerilogRequestLogging(options =>
{
    options.MessageTemplate = "HTTP {RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0000} ms";
});
app.UseCors("WebUi");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<StatusHub>("/hubs/status");
app.MapGet("/api/health", () => Results.Ok("SafePulse API is running"));
app.MapFallbackToFile("index.html");
app.Run();
