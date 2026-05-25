using System.Text.Json;

namespace HeartPulse.Localization;

public class JsonAppLocalizer : IAppLocalizer
{
    private const string DefaultLanguage = "en";
    private readonly Dictionary<string, Dictionary<string, string>> _translations;

    public JsonAppLocalizer(IWebHostEnvironment environment)
    {
        var root = Path.Combine(environment.ContentRootPath, "Translations");
        _translations = Directory.Exists(root)
            ? Directory.GetFiles(root, "*.json")
                .ToDictionary(
                    file => Path.GetFileNameWithoutExtension(file).ToLowerInvariant(),
                    file => JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(file)) ?? [])
            : [];
    }

    public string NormalizeLanguage(string? language)
    {
        var normalized = string.IsNullOrWhiteSpace(language)
            ? DefaultLanguage
            : language.Trim().ToLowerInvariant();

        return _translations.ContainsKey(normalized) ? normalized : DefaultLanguage;
    }

    public string Text(string key, string? language, params object[] args)
    {
        var normalized = NormalizeLanguage(language);
        var template = TryGet(normalized, key) ?? TryGet(DefaultLanguage, key) ?? key;
        return args.Length == 0 ? template : string.Format(template, args);
    }

    private string? TryGet(string language, string key)
    {
        return _translations.TryGetValue(language, out var values) && values.TryGetValue(key, out var value)
            ? value
            : null;
    }
}
