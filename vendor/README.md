# vendor

外部ライブラリをオフライン動作のためにリポジトリへ同梱している(CDN は使わない)。

| ファイル | ライブラリ | バージョン | ライセンス | 入手元 |
|---|---|---|---|---|
| `chart.umd.min.js` | [Chart.js](https://www.chartjs.org/) | 4.5.1 | MIT License(Copyright (c) 2014-2024 Chart.js Contributors) | npm `chart.js@4.5.1` の `dist/chart.umd.min.js` を無改変で複製 |

## 更新手順

1. `npm pack chart.js@<版>` で取得し、`package/dist/chart.umd.min.js` を本フォルダへ上書きする。
2. 本表のバージョンを更新する。
3. `sw.js` のキャッシュ名のバージョンを上げる(アセット変更時の必須作業)。

## Chart.js のライセンス全文

```
The MIT License (MIT)

Copyright (c) 2014-2024 Chart.js Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
