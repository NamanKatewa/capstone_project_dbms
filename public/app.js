
const formatCurrency = (amount) => 'Rs ' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const updateConsole = (sql) => {
    const consoleEl = document.getElementById('sql-output');
    const time = new Date().toLocaleTimeString();
    consoleEl.textContent = `[${time}] EXECUTING:\n${sql}\n\n` + consoleEl.textContent;
    const preEl = consoleEl.parentElement;
    if (preEl) {
        const startY = preEl.scrollTop;
        const duration = 500;
        let startTime = null;
        const step = (timestamp) => {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / duration, 1);
            preEl.scrollTop = startY * (1 - Math.pow(progress, 0.5)); 
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }
};
function openTab(evt, tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    evt.currentTarget.classList.add('active');
    if (tabId === 'tab-admin') { loadInventory(); loadAuditLogs(); }
}
async function init() {
    try {
        const catRes = await fetch('/api/categories');
        const categories = await catRes.json();
        const catSelect = document.getElementById('category-select');
        categories.forEach(c => {
            catSelect.innerHTML += `<option value="${c.category_id}">${c.category_name}</option>`;
        });
        const userRes = await fetch('/api/users');
        const users = await userRes.json();
        const userSelects = [document.getElementById('user-select'), document.getElementById('checkout-user-select')];
        users.forEach(u => {
            const option = `<option value="${u.user_id}">${u.username}</option>`;
            userSelects.forEach(s => s.innerHTML += option);
        });
        const prodRes = await fetch('/api/products');
        const prodData = await prodRes.json();
        const prodSelects = [document.getElementById('checkout-product-select'), document.getElementById('rec-product-select')];
        prodData.data.forEach(p => {
            const option = `<option value="${p.product_id}">${p.name} (Rs ${p.price})</option>`;
            prodSelects.forEach(s => s.innerHTML += option);
        });
        loadCatalog();
    } catch (e) {
        console.error("Init error", e);
    }
}
async function loadCatalog() {
    const search = document.getElementById('search-input').value;
    const category = document.getElementById('category-select').value;
    const sort = document.getElementById('sort-select').value;
    let url = `/api/products?`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (category) url += `&category_id=${category}`;
    if (sort) url += `&sort=${sort}`;
    const res = await fetch(url);
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    const container = document.getElementById('catalog-results');
    container.innerHTML = result.data.map(p => `
        <div class="card">
            <h3>${p.name}</h3>
            <p class="price">${formatCurrency(p.price)}</p>
            <p>Category: ${p.category_name || 'N/A'}</p>
            <p>Stock: ${p.stock}</p>
        </div>
    `).join('');
}
async function loadUserHistory() {
    const userId = document.getElementById('user-select').value;
    if (!userId) return;
    const res = await fetch(`/api/users/${userId}/history`);
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    const container = document.getElementById('history-results');
    if (result.data.length === 0) {
        container.innerHTML = '<p style="padding:1rem;">No order history found for this user.</p>';
        return;
    }
    let table = `<table><tr><th>Order ID</th><th>Date</th><th>Product</th><th>Category</th><th>Qty</th><th>Price</th><th>Order Total</th><th>Status</th></tr>`;
    result.data.forEach(row => {
        table += `<tr>
            <td>#${row.order_id}</td>
            <td>${new Date(row.order_date).toLocaleDateString()}</td>
            <td>${row.product_name}</td>
            <td>${row.category_name || 'N/A'}</td>
            <td>${row.quantity}</td>
            <td>${formatCurrency(row.unit_price)}</td>
            <td>${formatCurrency(row.total_amount)}</td>
            <td>${row.status}</td>
        </tr>`;
    });
    table += `</table>`;
    container.innerHTML = table;
}
async function simulateCheckout() {
    const userId = document.getElementById('checkout-user-select').value;
    const productId = document.getElementById('checkout-product-select').value;
    const qty = document.getElementById('checkout-qty').value;
    if (!userId || !productId) return;
    const payload = {
        user_id: parseInt(userId),
        items: [{ product_id: parseInt(productId), quantity: parseInt(qty) }]
    };
    const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    const container = document.getElementById('checkout-results');
    const statusData = result.data[0];
    container.innerHTML = `
        <h3>Transaction Result</h3>
        <p><strong>Status:</strong> ${statusData.status}</p>
        <p><strong>Message:</strong> ${statusData.message}</p>
    `;
    loadInventory();
    loadAuditLogs();
}
async function loadInventory() {
    const res = await fetch('/api/inventory');
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    const container = document.getElementById('inventory-results');
    let table = `<table><tr><th>ID</th><th>Name</th><th>Stock</th><th>Price</th><th>Action</th></tr>`;
    result.data.forEach(p => {
        table += `<tr>
            <td>${p.product_id}</td>
            <td>${p.name}</td>
            <td><input type="number" id="stock-${p.product_id}" value="${p.stock}" style="width:60px"></td>
            <td><input type="number" id="price-${p.product_id}" value="${p.price}" style="width:80px" step="0.01"></td>
            <td><button onclick="updateProduct(${p.product_id})">Update</button></td>
        </tr>`;
    });
    table += `</table>`;
    container.innerHTML = table;
}
async function updateProduct(id) {
    const stock = document.getElementById(`stock-${id}`).value;
    const price = document.getElementById(`price-${id}`).value;
    const res = await fetch(`/api/inventory/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock: parseInt(stock), price: parseFloat(price) })
    });
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    setTimeout(loadAuditLogs, 500); 
}
async function loadAuditLogs() {
    const res = await fetch('/api/audit-logs');
    const result = await res.json();
    if (result.sql && result.sql !== '') updateConsole(result.sql);
    const container = document.getElementById('audit-results');
    let table = `<table><tr><th>ID</th><th>Table</th><th>Action</th><th>Time</th><th>Changes</th></tr>`;
    result.data.forEach(log => {
        table += `<tr>
            <td>${log.log_id}</td>
            <td>${log.table_affected}</td>
            <td>${log.action}</td>
            <td>${new Date(log.timestamp).toLocaleString()}</td>
            <td style="font-size:0.85em;">
                <div><strong>Old:</strong> ${log.old_value}</div>
                <div><strong>New:</strong> ${log.new_value}</div>
            </td>
        </tr>`;
    });
    table += `</table>`;
    container.innerHTML = table;
}
function renderTable(containerId, data, columns) {
    const container = document.getElementById(containerId);
    if (!data || data.length === 0) {
        container.innerHTML = '<p>No data available.</p>';
        return;
    }
    let table = `<table><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
    data.forEach(row => {
        table += `<tr>${columns.map(c => {
            let val = row[c.key];
            if (c.type === 'currency') val = formatCurrency(val);
            return `<td>${val}</td>`;
        }).join('')}</tr>`;
    });
    table += `</table>`;
    container.innerHTML = table;
}
async function loadMonthlySales() {
    const res = await fetch('/api/analytics/monthly-sales');
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    renderTable('analytics-results', result.data, [
        { key: 'sale_month', label: 'Month' },
        { key: 'total_orders', label: 'Total Orders' },
        { key: 'total_revenue', label: 'Total Revenue', type: 'currency' }
    ]);
}
async function loadTopSpenders() {
    const res = await fetch('/api/analytics/top-spenders');
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    renderTable('analytics-results', result.data, [
        { key: 'username', label: 'Username' },
        { key: 'total_orders', label: 'Orders Placed' },
        { key: 'lifetime_value', label: 'Lifetime Value', type: 'currency' }
    ]);
}
async function loadCategoryRanks() {
    const res = await fetch('/api/analytics/category-ranks');
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    renderTable('analytics-results', result.data, [
        { key: 'category_name', label: 'Category' },
        { key: 'rank_in_category', label: 'Rank' },
        { key: 'product_name', label: 'Product Name' },
        { key: 'total_revenue', label: 'Revenue', type: 'currency' }
    ]);
}
async function loadRecommendations() {
    const productId = document.getElementById('rec-product-select').value;
    if (!productId) return;
    const res = await fetch(`/api/recommendations/${productId}`);
    const result = await res.json();
    if (result.sql) updateConsole(result.sql);
    const container = document.getElementById('recommend-results');
    if (result.data.length === 0) {
        container.innerHTML = '<p>No recommendations found for this product.</p>';
        return;
    }
    container.innerHTML = result.data.map(p => `
        <div class="card">
            <h3>${p.name}</h3>
            <p><strong>Bought Together:</strong> ${p.times_bought_together} times</p>
        </div>
    `).join('');
}
init();