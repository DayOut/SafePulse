using Microsoft.EntityFrameworkCore;
using MongoDB.EntityFrameworkCore.Extensions;
using HeartPulse.Data;
using HeartPulse.Options;
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

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

var app = builder.Build();
app.MapOpenApi();

app.MapControllers();
app.MapGet("/", () => Results.Ok("SafePulse API is running"));
app.Run();