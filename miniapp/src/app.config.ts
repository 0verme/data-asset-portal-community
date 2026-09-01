export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/search/index',
    'pages/assets/index',
    'pages/asset-detail/index',
    'pages/indicators/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#f5f7fb',
    navigationBarTitleText: '数据资产',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f5f7fb',
  },
  tabBar: {
    color: '#7d8797',
    selectedColor: '#1f5eff',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/assets/index', text: '资产' },
      { pagePath: 'pages/indicators/index', text: '指标' },
    ],
  },
})
