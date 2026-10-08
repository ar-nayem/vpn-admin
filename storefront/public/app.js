(async function () {
  const list = document.querySelector('#plan-list');
  const months = document.querySelector('#months');
  if (!list || !months) return;
  let plans = [];
  async function load() {
    try { plans = (await (await fetch('/api/catalog')).json()).packages; render(); }
    catch { list.innerHTML = '<p class="message error">Plans are temporarily unavailable. Please refresh.</p>'; }
  }
  function render() {
    const term = Number(months.value);
    list.innerHTML = plans.map((plan) => {
      const summary = StorefrontModel.planSummary(plan, term);
      return `<article class="plan"><div><h3>${plan.name}</h3><small>¥${plan.priceCny} per month</small></div><div class="price">¥${summary.priceCny}<small>${term} month${term > 1 ? 's' : ''}</small></div><div><strong>${summary.quotaGb} GB total</strong><small>${summary.speed}</small></div><a class="button" href="/checkout.html?plan=${encodeURIComponent(plan.id)}&months=${term}">Choose ${plan.name}</a></article>`;
    }).join('');
  }
  months.addEventListener('change', render);
  load();
}());
