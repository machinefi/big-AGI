/**
 * Application Identity (Brand)
 *
 * Also note that the 'Brand' is used in the following places:
 *  - README.md               all over
 *  - package.json            app-slug and version
 *  - [public/manifest.json]  name, short_name, description, theme_color, background_color
 */
export const Brand = {
  Title: {
    Base: 'Rapid-MLX on Big-AGI',
    Common: (process.env.NODE_ENV === 'development' ? '[DEV] ' : '') + 'Rapid-MLX on Big-AGI',
  },
  Meta: {
    Description: 'Rapid-MLX running on the Big-AGI chat surface — your local Apple Silicon LLM, fronted by a full chat UI with tool calling, personas, and voice. Pair with `rapid-mlx share` for a public link.',
    SiteName: 'Rapid-MLX on Big-AGI',
    ThemeColor: '#32383E',
    TwitterSite: '@enricoros',
  },
  URIs: {
    // rapid-mlx fork: point at our own domain. News page issue
    // links route to the rapid-mlx repo so feedback lands in the
    // right inbox.
    Home: 'https://rapidmlx.com',
    CardImage: 'https://big-agi.com/icons/card-dark-1200.png',
    OpenRepo: 'https://github.com/raullenchai/Rapid-MLX',
    OpenProject: 'https://github.com/raullenchai/Rapid-MLX',
    SupportInvite: '',
    PrivacyPolicy: 'https://rapidmlx.com/privacy',
    TermsOfService: 'https://rapidmlx.com/terms',
  },
  Docs: {
    Public: (docPage: string) => `https://big-agi.com/docs/${docPage}`,
  }
} as const;