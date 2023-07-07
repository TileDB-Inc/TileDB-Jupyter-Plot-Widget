const path = require('path');
const version = require('./package.json').version;

// Custom webpack rules
const rules = [
  { test: /\.ts$/, use: [{ loader: 'ts-loader' }], type: 'javascript/auto' },
  { test: /\.js$/, use:[{ loader: 'source-map-loader' }], type: 'javascript/auto' },
  { test: /\.css$/, use: [{ loader: 'style-loader' }, { loader: 'css-loader' }], type: 'javascript/auto'},
  { test: /\.svg/, type: 'asset/inline'},
];

// Packages that shouldn't be bundled but loaded at runtime
const externals = ['@jupyter-widgets/base'];

const resolve = {
  // Add '.ts' and '.tsx' as resolvable extensions.
  extensions: [".webpack.js", ".web.js", ".ts", ".js"]
};

module.exports = [
  /**
   * Embeddable @tiledb-inc/tiledb-plot-widget bundle
   *
   * This bundle is almost identical to the notebook extension bundle. The only
   * difference is in the configuration of the webpack public path for the
   * static assets.
   *
   * The target bundle is always `dist/index.js`, which is the path required by
   * the custom widget embedder.
   */
  {
    entry: './src/embed.ts',
    output: {
        filename: 'index.js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'amd',
        library: "@tiledb-inc/tiledb-plot-widget",
        publicPath: 'https://unpkg.com/@tiledb-inc/tiledb-plot-widget@' + version + '/dist/'
    },
    devtool: 'source-map',
    module: {
        rules: rules
    },
    externals,
    resolve,
  }
];