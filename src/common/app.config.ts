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
    Base: 'Big-AGI',
    Common: (process.env.NODE_ENV === 'development' ? '[DEV] ' : '') + 'Big-AGI',
  },
  Meta: {
    Description: 'Launch the open-source AI workspace for experts. BYO API keys. Compare and tune models, use personas, voice and vision - your data stays local.',
    SiteName: 'Big-AGI | The Expert\'s AI Workspace',
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