using HeartPulse.Commands;
using HeartPulse.Commands.Handlers;
using HeartPulse.Commands.Interfaces;
using Microsoft.EntityFrameworkCore;
using MongoDB.EntityFrameworkCore.Extensions;
using HeartPulse.Data;
using HeartPulse.Formatters.Interfaces;
using HeartPulse.Notifiers;
using HeartPulse.Notifiers.Builders;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Options;
using HeartPulse.Services;
using HeartPulse.Services.Interfaces;
using Telegram.Bot;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<TelegramOptions>(builder.Configuration.GetSection("Telegram"));

var mongoConn = builder.Configuration.GetValue<string>("Mongo:ConnectionString")!;
var mongoDb   = builder.Configuration.GetValue<string>("Mongo:Database") ?? "safepulse";

builder.Services.AddDbContext<SafePulseContext>(opt =>
    opt.UseMongoDB(mongoConn, mongoDb));

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.PropertyNamingPolicy = null);

builder.Services.AddEndpointsApiExplorer();

builder.Services.AddSingleton<ITelegramBotClient>(sp =>
{
    var cfg = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<TelegramOptions>>().Value;
    return new TelegramBotClient(cfg.BotToken);
});

var services = builder.Services;
services.AddScoped<IUserService, UserService>();
services.AddScoped<IGroupService, GroupService>();
services.AddScoped<IGroupNotificationBuilder, GroupNotificationBuilder>();
services.AddScoped<IGroupNotifier, TelegramGroupNotifier>();
// services.AddScoped<ITelegramTextFormatter, TelegramTextFormatter>();
services.AddScoped<ITelegramCommandDispatcher, TelegramCommandDispatcher>();

// Реєструєш усі хендлери
services.AddScoped<ITelegramCommandHandler, SafeCommandHandler>();
services.AddScoped<ITelegramCommandHandler, HelpCommandHandler>();
services.AddScoped<ITelegramCommandHandler, ShelterCommandHandler>();
services.AddScoped<ITelegramCommandHandler, GroupListCommandHandler>();
services.AddScoped<ITelegramCommandHandler, StartCommandHandler>();
services.AddScoped<ITelegramCommandHandler, CreateGroupCommandHandler>();
services.AddScoped<ITelegramCommandHandler, JoinGroupCommandHandler>();
// services.AddScoped<ITelegramCommandHandler, UnknownCommandHandler>();

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

var app = builder.Build();
app.MapOpenApi();

app.MapControllers();
app.MapGet("/", () => Results.Ok("SafePulse API is running"));
app.Run();