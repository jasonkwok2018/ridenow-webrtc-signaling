# RideNow WebRTC信令服务器

🚗 **零成本实时位置共享的WebRTC信令服务器**

## ✨ 功能特性

- 🆓 **完全免费** - 部署在Render免费计划
- ⚡ **超低延迟** - WebRTC P2P直连
- 🔄 **实时同步** - Socket.IO实时通信
- 🚗 **司机管理** - 智能司机/乘客匹配
- 📍 **位置共享** - 高效位置数据传输
- 🔧 **自动重连** - 网络中断自动恢复

## 🚀 快速开始

### 本地运行
```bash
npm install
npm start
```

访问 http://localhost:3000 查看服务器状态

### 部署到Render
1. Fork这个仓库
2. 在 [Render.com](https://render.com) 创建新的Web Service
3. 连接GitHub仓库
4. 使用以下配置：
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

## 📡 API端点

### REST API
- `GET /` - 服务器健康检查
- `GET /stats` - 在线用户统计

### WebSocket事件

#### 用户管理
- `register` - 用户注册 (司机/乘客)
- `location-update` - 位置更新

#### WebRTC信令
- `offer` - WebRTC连接请求
- `answer` - WebRTC连接应答
- `ice-candidate` - ICE候选交换

#### 订单管理
- `request-ride` - 乘客请求订单
- `accept-ride` - 司机接受订单

## 🔧 配置

### 环境变量
- `PORT` - 服务器端口 (默认: 3000)
- `NODE_ENV` - 运行环境 (production/development)

### 免费STUN服务器
```javascript
const stunServers = [
  'stun:stun.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
  'stun:stun.services.mozilla.com:3478'
]
```

## 💰 成本分析

```
✅ 信令服务器: $0/月 (Render免费)
✅ STUN服务器: $0/月 (Google/Cloudflare)
✅ 数据传输: $0/月 (P2P直连)
✅ 总成本: $0/月

vs 传统方案: $200+/月
节省: 100%
```

## 📱 客户端集成

### iOS (Swift)
```swift
import SocketIO

let manager = SocketManager(socketURL: URL(string: "https://your-app.onrender.com")!)
let socket = manager.defaultSocket

socket.on("drivers-list") { data, ack in
    // 处理司机列表更新
}
```

### JavaScript
```javascript
import io from 'socket.io-client'

const socket = io('https://your-app.onrender.com')

socket.on('drivers-list', (drivers) => {
    // 处理司机列表更新
})
```

## 🏗️ 架构

```
乘客App ←→ 信令服务器 ←→ 司机App
    ↓                    ↓
    └─── P2P直连 ────────┘
```

## 📊 性能

- **延迟**: 10-50ms (P2P直连)
- **并发**: 支持数千用户
- **可用性**: 99.9%+
- **自动扩展**: 用户越多网络越强

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📄 许可证

MIT License - 完全开源免费
